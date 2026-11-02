#!/bin/sh
# 容器入口: 先把管理端口透传到局域网, 再启动独立服务。
#
# 背景: 上游独立服务把管理端口(默认 18900)强制绑定在 loopback(127.0.0.1),
#       不支持 --host (issue #216), 因此局域网其他设备用宿主 IP 访问管理端口会被拒 (10061)。
#
# 做法: 对放行列表中的每个主机起一个 socat 转发 <IP>:<管理端口> -> 127.0.0.1:<管理端口>。
#   - 关键: 只绑具体 IP, 绝不绑 0.0.0.0(0.0.0.0 包含 loopback, 会与 app 的 127.0.0.1:18900
#     冲突导致 EADDRINUSE, 管理端口起不来)。绑具体 IP 与 app 的 loopback 监听互不冲突。
#   - 纯 TCP 转发, 保留原始 Host/Origin 头; 管理页仍需 managementKey 登录。
#   - 完全不动上游源码 (符合策略一: 不改源码, 仅用 LAN 中继/转发暴露)。
#
# 可用环境变量(均可选, 不设即用上游默认):
#   OFM_TRUSTED_HOSTS  放行访问管理页的主机列表(逗号分隔); 不设则自动探测非 loopback IPv4
#   OFM_LAN_IP         EAC router 各类「添加账号」登录回调使用的局域网主 IP; 不设则自动探测。
#                      设为该 IP 后, 临时 OAuth 回调服务会绑定并在此 IP 上对外展示链接,
#                      使局域网其他设备能正常完成登录(否则写死 127.0.0.1, 设备连不到宿主)。
#   OFM_ADMIN_PORT     管理端口, 默认 18900
#   OFM_LAN_PORT       网关(LAN 中继)端口, 默认 18901
set -e

ADMIN_PORT="${OFM_ADMIN_PORT:-18900}"
LAN_PORT="${OFM_LAN_PORT:-18901}"

# EAC router 登录回调用的局域网主 IP: 手动指定优先; 未指定则自动探测
# (排除 docker 网桥 172.16/12、链路本地 169.254 等, 取首个真实局域网 IPv4)。
if [ -z "$OFM_LAN_IP" ]; then
  OFM_LAN_IP="$(node -e '
    const os=require("os");const n=os.networkInterfaces();const out=[];
    for(const k in n){for(const a of n[k]){
      if(a.family==="IPv4"&&!a.internal){
        const ip=a.address;
        if(ip.startsWith("172.")||ip.startsWith("169.254.")) continue;
        out.push(ip);
      }
    }}
    process.stdout.write(out[0]||"");
  ')"
  if [ -n "$OFM_LAN_IP" ]; then
    echo "已自动探测局域网主 IP (OFM_LAN_IP): $OFM_LAN_IP"
  fi
fi
if [ -n "$OFM_LAN_IP" ]; then export OFM_LAN_IP; fi

# 上游 Host 信任围栏默认只认 loopback; 经 docker/patch-trust.mjs 补丁后,
# 可用 OFM_TRUSTED_HOSTS 额外放行局域网 IP, 使管理页对其他设备可用。
# 手动指定优先(桥接网络等无法自动探测宿主 IP 的场景); 未指定时才自动探测。
if [ -n "$OFM_TRUSTED_HOSTS" ]; then
  echo "使用手动指定的放行主机: OFM_TRUSTED_HOSTS=$OFM_TRUSTED_HOSTS"
else
  LAN_IPS="$(node -e 'const os=require("os");const n=os.networkInterfaces();const out=[];for(const k in n){for(const a of n[k]){if(a.family==="IPv4"&&!a.internal)out.push(a.address);}}process.stdout.write(out.join(" "))')"
  if [ -n "$LAN_IPS" ]; then
    OFM_TRUSTED_HOSTS="$(echo "$LAN_IPS" | tr ' ' ',')"
    export OFM_TRUSTED_HOSTS
    echo "已自动放行局域网主机: OFM_TRUSTED_HOSTS=$OFM_TRUSTED_HOSTS"
  else
    echo "未检测到非 loopback IPv4 且未指定 OFM_TRUSTED_HOSTS, 管理页仅本机 127.0.0.1:$ADMIN_PORT 可用"
  fi
fi

for ip in $(echo "$OFM_TRUSTED_HOSTS" | tr ',' ' '); do
  # 后台子 shell: 单个 IP 绑定失败(如桥接网络下该 IP 不在容器内)不影响主服务启动
  ( socat TCP-LISTEN:${ADMIN_PORT},bind=${ip},reuseaddr,fork TCP:127.0.0.1:${ADMIN_PORT} \
      && echo "管理端口透传已启动: ${ip}:${ADMIN_PORT} -> 127.0.0.1:${ADMIN_PORT}" \
      || echo "警告: 无法在 ${ip}:${ADMIN_PORT} 上透传(该 IP 不在本容器内?), 跳过" ) &
done

# 仅在显式设置了端口环境变量时, 替换镜像 CMD 里的 --port / --lan-port
if [ -n "${OFM_ADMIN_PORT:-}" ] || [ -n "${OFM_LAN_PORT:-}" ]; then
  kept=""
  skip=0
  for a in "$@"; do
    if [ "$skip" = "1" ]; then skip=0; continue; fi
    case "$a" in
      --port|--lan-port) skip=1; continue ;;
      --port=*|--lan-port=*) continue ;;
    esac
    kept="$kept $a"
  done
  # 参数均不含空格, 直接重建位置参数
  # shellcheck disable=SC2086
  set -- $kept
  if [ -n "${OFM_ADMIN_PORT:-}" ]; then set -- "$@" --port "$ADMIN_PORT"; fi
  if [ -n "${OFM_LAN_PORT:-}" ]; then set -- "$@" --lan-port "$LAN_PORT"; fi
  echo "端口覆盖: --port $ADMIN_PORT --lan-port $LAN_PORT"
fi

exec node packages/standalone/cli.mjs "$@"

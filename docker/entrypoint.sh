#!/bin/sh
# 容器入口: 先把管理端口透传到局域网, 再启动独立服务。
#
# 背景: 上游独立服务把管理端口(默认 18900)强制绑定在 loopback(127.0.0.1),
#       不支持 --host (issue #216), 因此局域网其他设备访问 <宿主IP>:18900 会被拒 (10061)。
#
# 做法: 对每个「非 loopback 的 IPv4 地址」起一个 socat 转发  <LAN_IP>:18900 -> 127.0.0.1:18900。
#   - 关键: 只绑具体 LAN IP, 绝不绑 0.0.0.0(0.0.0.0 包含 loopback, 会与 app 的 127.0.0.1:18900
#     冲突导致 EADDRINUSE, 管理端口起不来)。绑具体 IP 与 app 的 loopback 监听互不冲突。
#   - 纯 TCP 转发, 保留原始 Host/Origin 头, 不触发上游 Host 信任围栏; 管理页仍需 managementKey 登录。
#   - 完全不动上游源码 (符合策略一: 不改源码, 仅用 LAN 中继/转发暴露)。
set -e

# 列出所有非 loopback 的 IPv4 地址 (--network host 下即宿主局域网 IP)
LAN_IPS="$(node -e 'const os=require("os");const n=os.networkInterfaces();const out=[];for(const k in n){for(const a of n[k]){if(a.family==="IPv4"&&!a.internal)out.push(a.address);}}process.stdout.write(out.join(" "))')"

if [ -n "$LAN_IPS" ]; then
  # 上游 Host 信任围栏默认只认 loopback; 经 docker/patch-trust.mjs 补丁后,
  # 可用 OFM_TRUSTED_HOSTS 额外放行局域网 IP, 使管理页对其他设备可用。
  export OFM_TRUSTED_HOSTS="$(echo "$LAN_IPS" | tr ' ' ',')"
  echo "已放行局域网主机: OFM_TRUSTED_HOSTS=$OFM_TRUSTED_HOSTS"
  for ip in $LAN_IPS; do
    echo "管理端口透传: ${ip}:18900 -> 127.0.0.1:18900"
    socat TCP-LISTEN:18900,bind=${ip},reuseaddr,fork TCP:127.0.0.1:18900 &
  done
else
  echo "未检测到非 loopback IPv4, 跳过管理端口局域网透传 (仅本机 127.0.0.1:18900 可用)"
fi

exec node packages/standalone/cli.mjs "$@"

#!/usr/bin/env bash
# 本地容器测试环境启动器 (one-shot, 可重复执行)
#
# 作用:
#   1. 以 --network host 启动 our-free-model 容器, 把 /data 持久绑定到 local-test/data
#      (镜像内含 socat 转发 0.0.0.0:18900 -> 127.0.0.1:18900, 管理页 18900 现已对局域网可达)
#   2. 首次启动(无 settings.json)时, 注入"固定 LAN Key"后重启, 保证后续所有本地测试
#      复用同一网关 Key (机制: 上游 service.mjs 仅在 standaloneLanKey 为空/等于 forwardKey
#      时才重新随机生成; 写入一个非空且不等于 forwardKey 的固定值即被沿用)
#   3. 已存在 local-test/data/settings.json 时直接启动, 沿用已固定 Key
#
# 使用:
#   ./local-test/start-local.sh            # 启动/复用
#   docker stop ofm                         # 停止
#   docker restart ofm && docker logs ofm | grep -i login | tail -1   # 刷新管理页一次性登录链接
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DATA_DIR="$REPO_DIR/local-test/data"
IMAGE="our-free-model:v2.7.4-docker-0.2"
CONTAINER="ofm"
FIXED_LAN_KEY="LANKEY-local-fixed-2026-00000001"

mkdir -p "$DATA_DIR"

if docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "容器 $CONTAINER 已在运行 (--network host)"
else
  if [ ! -f "$DATA_DIR/settings.json" ]; then
    echo "首次启动: 生成 settings 并注入固定 LAN Key ..."
    docker run -d --name "$CONTAINER" --network host -v "$DATA_DIR:/data" \
      --restart unless-stopped "$IMAGE" >/dev/null
    sleep 5
    docker stop "$CONTAINER" >/dev/null
    docker run --rm --entrypoint node -v "$DATA_DIR:/data" "$IMAGE" -e "
      const fs=require('fs');const p='/data/settings.json';
      const j=JSON.parse(fs.readFileSync(p,'utf8'));
      j.standaloneLanKey='$FIXED_LAN_KEY';
      fs.writeFileSync(p, JSON.stringify(j, null, 2));
    "
    docker start "$CONTAINER" >/dev/null
    sleep 4
  else
    docker start "$CONTAINER" >/dev/null || \
      docker run -d --name "$CONTAINER" --network host -v "$DATA_DIR:/data" \
        --restart unless-stopped "$IMAGE" >/dev/null
    sleep 4
  fi
fi

echo
# 取管理密钥(managementKey, 仅容器内 root 可读宿主绑定文件)
MGMT_KEY="$(docker exec "$CONTAINER" node -e 'console.log(JSON.parse(require("fs").readFileSync("/data/settings.json","utf8")).managementKey)' 2>/dev/null)"

echo "=== 本地测试环境已就绪 (--network host) ==="
echo
echo "【两个 Key 用途不同, 别混】"
echo "  LAN Key (固定, 网关用) : $FIXED_LAN_KEY"
echo "     -> 仅用于 18901 网关 API: Authorization: Bearer $FIXED_LAN_KEY"
echo "  Management Key (管理页用): ${MGMT_KEY:-<读取失败>}"
echo "     -> 仅用于 18900 管理页登录: 打开页后粘贴进『令牌』框 (稳定不过期)"
echo
echo "网关(对外)   : http://127.0.0.1:18901/v1   或  http://<宿主IP>:18901/v1 (局域网设备同)"
echo "管理页(本机/局域网): http://127.0.0.1:18900  或  http://<宿主IP>:18900 (socat 已透传)"
echo "   登录: 粘贴上方 Management Key (稳定不过期); 也可用一次性链接"
echo "刷新一次性链接: docker restart $CONTAINER && docker logs $CONTAINER | grep -i login | tail -1"
echo "停止容器     : docker stop $CONTAINER"

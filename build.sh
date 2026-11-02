#!/usr/bin/env bash
# 构建并打标签. 版本约定: v{上游}.docker.{批次}
# 上游版本跟随: 自动读取上游 packages/standalone/package.json 的 version 字段.
#
# 用法:
#   ./build.sh                        -> UPSTREAM_REF=v2.8.0, 自动取上游版本, BATCH=0.1
#   UPSTREAM_REF=v2.8.0 ./build.sh     -> 锁定上游 tag v2.8.0, 复现可构建
#   BATCH=0.2 ./build.sh              -> 同一上游, 新批次
set -euo pipefail

UPSTREAM_REF="${UPSTREAM_REF:-v2.8.0}"
BATCH="${BATCH:-0.1}"
# 镜像名: 远程拉取/推送统一为 ghcr.io/hlee-fun/our-free-model:latest
# (版本信息通过 tag 副标签保留: ghcr.io/hlee-fun/our-free-model:v{上游}-docker-{批次})
IMAGE="${IMAGE:-ghcr.io/hlee-fun/our-free-model}"

# 跟随上游获取版本号(读取项目根 package.json 的 version 字段 = 项目发布版本, 如 2.8.0;
# 注意: packages/standalone/package.json 是子包版本, 会滞后为 2.7.1, 不采用)
UPSTREAM_VERSION="$(curl -fsSL "https://raw.githubusercontent.com/Ebony-Vinyl/dsh-our-free-model/${UPSTREAM_REF}/package.json" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).version))')"

VERSION_TAG="v${UPSTREAM_VERSION}-docker-${BATCH}"
echo "==> 上游版本: ${UPSTREAM_VERSION} | ref: ${UPSTREAM_REF} | 镜像: ${IMAGE}:latest (副标签 ${IMAGE}:${VERSION_TAG})"

docker build \
  --build-arg "UPSTREAM_REF=${UPSTREAM_REF}" \
  --build-arg "UPSTREAM_VERSION=${UPSTREAM_VERSION}" \
  -t "${IMAGE}:latest" \
  -t "${IMAGE}:${VERSION_TAG}" \
  -f Dockerfile .

echo "==> 完成: ${IMAGE}:latest"
echo "    仅 LAN 网关: docker run -d -p 18901:18901 -v ofm-data:/data ${IMAGE}:latest"
echo "    网关+管理(管理经 socat 透传到局域网): docker run -d -p 18900:18900 -p 18901:18901 -v ofm-data:/data ${IMAGE}:latest"

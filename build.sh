#!/usr/bin/env bash
# 构建并打标签. 版本约定: v{上游}[-main].docker.{批次}
# 默认跟随上游 main 全量重建(2026-11-06 已验证四个补丁零冲突).
# 0.6 起镜像默认入口含 testModel 运行时补丁(修复 Unknown model), 见 docker/start-patched.mjs.
#
# 用法:
#   ./build.sh                        -> UPSTREAM_REF=main, BATCH=0.6, tag v2.8.0-main-docker-0.6
#   UPSTREAM_REF=v2.8.0 ./build.sh     -> 锁定上游 tag v2.8.0, 复现旧版
#   BATCH=0.7 ./build.sh              -> 同一上游, 指定其他批次
#   GIT_SSL_NO_VERIFY=true BUILD_NETWORK=host ./build.sh
#       -> TLS 中间代理环境: 构建期 clone 走宿主代理且跳过代理自签证书校验
#   (上游 git 不可达时, 可本地自备离线叠加补丁层 Dockerfile; 该文件属本地应急文件, 不入库)
set -euo pipefail

UPSTREAM_REF="${UPSTREAM_REF:-main}"
BATCH="${BATCH:-0.6}"
GIT_SSL_NO_VERIFY="${GIT_SSL_NO_VERIFY:-false}"
BUILD_NETWORK="${BUILD_NETWORK:-}"
# 镜像名: 远程拉取/推送统一为 ghcr.io/hlee-fun/our-free-model:latest
IMAGE="${IMAGE:-ghcr.io/hlee-fun/our-free-model}"

# 跟随上游获取版本号(读取项目根 package.json 的 version 字段 = 项目发布版本, 如 2.8.0;
# 注意: packages/standalone/package.json 是子包版本, 会滞后为 2.7.1, 不采用)
UPSTREAM_VERSION="$(curl -fsSL "https://raw.githubusercontent.com/Ebony-Vinyl/dsh-our-free-model/${UPSTREAM_REF}/package.json" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).version))')"

# 跟随 main 时在版本里显式标注, 与锁定 tag 的旧批次区分
REF_SUFFIX=""
if [ "${UPSTREAM_REF}" = "main" ]; then REF_SUFFIX="-main"; fi
VERSION_TAG="v${UPSTREAM_VERSION}${REF_SUFFIX}-docker-${BATCH}"
echo "==> 上游版本: ${UPSTREAM_VERSION} | ref: ${UPSTREAM_REF} | 镜像: ${IMAGE}:latest (副标签 ${IMAGE}:${VERSION_TAG})"

# 代理环境变量按需透传为 Docker 预定义 build-arg(RUN 阶段自动生效); 无代理时为空
PROXY_ARGS=()
for v in HTTP_PROXY HTTPS_PROXY NO_PROXY http_proxy https_proxy no_proxy; do
  if [ -n "${!v:-}" ]; then PROXY_ARGS+=(--build-arg "${v}=${!v}"); fi
done
# BUILD_NETWORK=host 让构建期 clone 能访问宿主的 127.0.0.1 代理
NETWORK_ARGS=()
if [ -n "${BUILD_NETWORK}" ]; then NETWORK_ARGS+=(--network "${BUILD_NETWORK}"); fi

docker build \
  "${NETWORK_ARGS[@]}" \
  "${PROXY_ARGS[@]}" \
  --build-arg "UPSTREAM_REF=${UPSTREAM_REF}" \
  --build-arg "UPSTREAM_VERSION=${UPSTREAM_VERSION}" \
  --build-arg "GIT_SSL_NO_VERIFY=${GIT_SSL_NO_VERIFY}" \
  -t "${IMAGE}:latest" \
  -t "${IMAGE}:${VERSION_TAG}" \
  -f Dockerfile .

echo "==> 完成: ${IMAGE}:latest (${IMAGE}:${VERSION_TAG})"
echo "    仅 LAN 网关: docker run -d -p 18901:18901 -v ofm-data:/data ${IMAGE}:latest"
echo "    网关+管理(管理经 socat 透传到局域网): docker run -d -p 18900:18900 -p 18901:18901 -v ofm-data:/data ${IMAGE}:latest"

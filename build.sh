#!/bin/sh
# 构建并打标签. 版本约定: v{上游}.docker.{批次}
# 用法: ./build.sh [上游tag] [批次]
#   ./build.sh 2.7.4 0.1   ->  our-free-model:v2.7.4-docker-0.1
set -eu

UPSTREAM_TAG="${1:-2.7.4}"
BATCH="${2:-0.1}"
IMAGE="our-free-model"
TAG="v${UPSTREAM_TAG}-docker-${BATCH}"

echo "构建 ${IMAGE}:${TAG} (上游 tag=${UPSTREAM_TAG})"
docker build --build-arg "UPSTREAM_TAG=${UPSTREAM_TAG}" \
  -t "${IMAGE}:${TAG}" -t "${IMAGE}:latest" .

echo "完成: ${IMAGE}:${TAG}"

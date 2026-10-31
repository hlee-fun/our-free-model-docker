# dsh-our-free-model 独立运行镜像
# 策略一: LAN 推理中继(--lan)对外暴露网关, 管理监听器留 loopback(18900)
# 版本约定: v{上游}.docker.{批次}  ->  首个 v2.7.4-docker-0.1
# 构建时锁定上游 tag 拉取源码; 运行时零 npm 依赖.
#
# 注意: 上游独立路径不得残留 @deepseek-ai/* import(否则运行期缺包崩溃).
#       构建/运行验证见 PLAN.md 第九章与第十一章.

ARG UPSTREAM_TAG=2.7.4

FROM node:22-bookworm AS builder
ARG UPSTREAM_TAG=2.7.4
RUN apt-get update \
 && apt-get install -y --no-install-recommends git \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /src
# 锁定上游版本(浅克隆). packages/standalone/web 为已提交构建产物, 无需前端构建.
RUN git clone --depth 1 --branch "${UPSTREAM_TAG}" https://github.com/Ebony-Vinyl/dsh-our-free-model.git /src \
 && git -C /src log -1 --oneline

FROM node:22-bookworm-slim AS runtime
ENV OFM_HOME=/data
ENV NODE_ENV=production
WORKDIR /app

# 仅复制独立运行所需文件(不含 .git / node_modules / 凭据)
COPY --from=builder /src/LICENSE ./LICENSE
COPY --from=builder /src/scripts/standalone-third-party.txt ./scripts/standalone-third-party.txt
COPY --from=builder /src/packages/standalone ./packages/standalone
COPY --from=builder /src/src ./src
COPY --from=builder /src/vendor/channel-pack ./vendor/channel-pack
COPY --from=builder /src/vendor/magpie ./vendor/magpie

VOLUME ["/data"]
EXPOSE 18900 18901
ENTRYPOINT ["node", "packages/standalone/cli.mjs"]
CMD ["--lan", "--lan-port", "18901"]

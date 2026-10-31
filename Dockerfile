# syntax=docker/dockerfile:1
# our-free-model 独立运行镜像 (策略一: LAN 推理中继对外, 管理留 loopback)
# 版本: v{上游}.docker.{批次}  (上游版本跟随, 见 build.sh)
#
# 排除 DSH 依赖的正确做法: 构建期调用上游自带的打包清单
#   scripts/pack-standalone.mjs -> standaloneSourceFiles()
# 该清单列出「独立服务真正需要的精确文件」, DSH 内核耦合的插件代码根本不在清单内,
# 因此只复制清单文件即可自动排除任何 DSH 依赖, 且随上游同步、不会漏拷。

ARG UPSTREAM_REF=main
FROM node:22-bookworm-slim AS builder
ARG UPSTREAM_REF
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /src
# 构建时浅克隆(仅一次提交, 不带入完整历史与 DSH 插件产物)
RUN git clone --depth 1 --branch "${UPSTREAM_REF}" https://github.com/Ebony-Vinyl/dsh-our-free-model /src \
 || (git clone --depth 1 https://github.com/Ebony-Vinyl/dsh-our-free-model /src && git -C /src checkout "${UPSTREAM_REF}")
# 用上游自带清单提取「仅独立所需」文件 -> /dist (自动排除 DSH 依赖部分)
COPY docker/extract-standalone.mjs /extract-standalone.mjs
RUN node /extract-standalone.mjs

FROM node:22-bookworm-slim AS runtime
ARG UPSTREAM_VERSION=unknown
ENV OFM_HOME=/data
ENV NODE_ENV=production
WORKDIR /app
# 仅复制独立服务所需文件(无 npm install, 无 DSH 依赖)
COPY --from=builder /dist/ /app/
# 极小补丁: 让 src/trust.js 的 Host 信任围栏支持 OFM_TRUSTED_HOSTS
# (未设置该环境变量时行为与上游完全一致; 见 docker/patch-trust.mjs)
COPY docker/patch-trust.mjs /patch-trust.mjs
RUN node /patch-trust.mjs
# socat: 把 loopback 的管理端口透传到局域网(纯 TCP 转发, 不改上游源码)
RUN apt-get update \
 && apt-get install -y --no-install-recommends socat \
 && rm -rf /var/lib/apt/lists/*
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
VOLUME ["/data"]
# LAN 推理中继 18901(0.0.0.0, 对外网关) + 管理端口 18900(socat 透传到局域网)
EXPOSE 18900 18901
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:18900/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/entrypoint.sh"]
CMD ["--lan", "--lan-port", "18901", "--data-dir", "/data"]

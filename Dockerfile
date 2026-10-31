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
RUN node --input-type=module -e '
  import { standaloneSourceFiles } from "./scripts/pack-standalone.mjs";
  import fs from "node:fs";
  import path from "node:path";
  const files = standaloneSourceFiles();
  fs.mkdirSync("/dist", { recursive: true });
  for (const f of files) {
    const s = path.join("/src", f);
    if (!fs.existsSync(s)) { console.error("MISSING in upstream:", f); process.exit(1); }
    const d = path.join("/dist", f);
    fs.mkdirSync(path.dirname(d), { recursive: true });
    fs.copyFileSync(s, d);
  }
  console.log("Extracted", files.length, "standalone files");
'

FROM node:22-bookworm-slim AS runtime
ARG UPSTREAM_VERSION=unknown
ENV OFM_HOME=/data
ENV NODE_ENV=production
WORKDIR /app
# 仅复制独立服务所需文件(无 npm install, 无 DSH 依赖)
COPY --from=builder /dist/ /app/
VOLUME ["/data"]
# LAN 推理中继端口(0.0.0.0, 对外网关); 管理端口 18900 仅容器内回环, 不在此 EXPOSE
EXPOSE 18901
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:18900/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["node", "packages/standalone/cli.mjs"]
CMD ["--lan", "--lan-port", "18901", "--data-dir", "/data"]

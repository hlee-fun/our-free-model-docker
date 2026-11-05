# syntax=docker/dockerfile:1
# our-free-model 独立运行镜像 (策略一: LAN 推理中继对外, 管理留 loopback)
# 版本: v{上游}-main-docker.{批次}  (默认跟随上游 main, 见 build.sh)
#
# 2026-11-06 跟随上游重建: 重新拉取上游 main (efea0462) 全量源码并原样重放四个补丁,
#   已验证零冲突 —— 镜像内 business.mjs 去掉哨兵并逆向还原 12 处替换后逐字节等于上游
#   main 原版; 四个补丁目标文件 node --check 全通过; provider 登录回调、Host 回写、
#   clipboard 降级、LAN Key 鉴权均在全新容器中实测通过。
#   相对旧版的两处实质变化:
#     1) 默认跟随 upstream main 全量重建(不再基于旧 tag 叠加补丁层), build.sh 默认 ref=main;
#     2) 新增 ENV OUR_FREE_MODEL_FREE_TRANSPORT=node —— 上游 main 的 src/egress.js 把 free
#        目录默认传输改为 auto(优先 Bun), 本镜像不含 Bun, 不设该变量会导致 free 清单刷新失败。
# 0.6 追加: 默认启动入口改为 docker/start-patched.mjs(运行时补丁, 不改上游源码), 重写
#   runtime.testModel, 让 worker 渠道模型(loomy/qoder/trae...)的「测试模型」不再误报
#   Unknown model; 设 OFM_DISABLE_TESTMODEL_PATCH=1 可回退到上游 cli.mjs。
#
# 排除 DSH 依赖的正确做法: 构建期调用上游自带的打包清单
#   scripts/pack-standalone.mjs -> standaloneSourceFiles()
# 该清单列出「独立服务真正需要的精确文件」, DSH 内核耦合的插件代码根本不在清单内,
# 因此只复制清单文件即可自动排除任何 DSH 依赖, 且随上游同步、不会漏拷。

ARG UPSTREAM_REF=main
FROM node:22-bookworm-slim AS builder
ARG UPSTREAM_REF
# 可选: 仅在 TLS 中间代理环境(构建期 clone 无法校验代理自签证书)显式传
#   --build-arg GIT_SSL_NO_VERIFY=true 关闭校验; 默认 false 保持证书校验。
ARG GIT_SSL_NO_VERIFY=false
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /src
# 构建时浅克隆(仅一次提交, 不带入完整历史与 DSH 插件产物)
RUN git -c http.sslVerify="${GIT_SSL_NO_VERIFY}" clone --depth 1 --branch "${UPSTREAM_REF}" https://github.com/Ebony-Vinyl/dsh-our-free-model /src \
 || (git -c http.sslVerify="${GIT_SSL_NO_VERIFY}" clone --depth 1 https://github.com/Ebony-Vinyl/dsh-our-free-model /src && git -C /src checkout "${UPSTREAM_REF}")
# 用上游自带清单提取「仅独立所需」文件 -> /dist (自动排除 DSH 依赖部分)
COPY docker/extract-standalone.mjs /extract-standalone.mjs
RUN node /extract-standalone.mjs

FROM node:22-bookworm-slim AS runtime
ARG UPSTREAM_VERSION=unknown
ENV OFM_HOME=/data
ENV NODE_ENV=production
# 上游 main 起 free 目录传输默认为 auto(优先 Bun); 镜像内无 Bun, 固定走 Node 传输层
ENV OUR_FREE_MODEL_FREE_TRANSPORT=node
WORKDIR /app
# 仅复制独立服务所需文件(无 npm install, 无 DSH 依赖)
COPY --from=builder /dist/ /app/
# 四个容器化补丁(顺序与 2026-11-06 验证一致, 均带哨兵/幂等; 不改上游源码)
# 极小补丁: 让 src/trust.js 的 Host 信任围栏支持 OFM_TRUSTED_HOSTS
# (未设置该环境变量时行为与上游完全一致; 见 docker/patch-trust.mjs)
COPY docker/patch-trust.mjs /patch-trust.mjs
RUN node /patch-trust.mjs
# 容器化补丁: 让 /api/management/summary 按请求实际 Host 回写 baseUrl,
# 修复局域网访问时前端 baseUrl 写死 127.0.0.1 导致 API/跳转失败(自动获取, 非固定值)。
COPY docker/patch-baseurl.mjs /patch-baseurl.mjs
RUN node /patch-baseurl.mjs
# 容器化补丁: 让 EAC router 各类「添加账号」登录流(临时 OAuth 回调服务)的绑定地址
# 与对外 URL 改用 OFM_LAN_IP, 修复局域网下写成 127.0.0.1 导致设备连不到宿主。
# 未设置 OFM_LAN_IP 时行为与上游完全一致(127.0.0.1)。
COPY docker/patch-lan-login.mjs /patch-lan-login.mjs
RUN node /patch-lan-login.mjs
# 复制修复: API 接入页复制按钮在局域网 HTTP(non-secure context)下 navigator.clipboard
# 为 undefined, 直接读 .writeText 报错; 改为可选链判空 + execCommand 降级(与 client.js 一致)。
# 仅替换构建产物 app.js 中这一处字符串, 带哨兵标记, 可重复执行(幂等); 不改上游源码。
COPY docker/patch-clipboard.mjs /patch-clipboard.mjs
RUN node /patch-clipboard.mjs
# socat: 把 loopback 的管理端口透传到局域网(纯 TCP 转发, 不改上游源码)
RUN apt-get update \
 && apt-get install -y --no-install-recommends socat \
 && rm -rf /var/lib/apt/lists/*
# 运行时补丁入口: startStandalone 返回后重写 runtime.testModel(不改动任何上游文件)。
# 由 /entrypoint.sh 默认调用; 上游 cli.mjs 仍保留, 可用环境变量开关回退。
COPY docker/start-patched.mjs /app/start-patched.mjs
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
VOLUME ["/data"]
# LAN 推理中继 18901(0.0.0.0, 对外网关) + 管理端口 18900(socat 透传到局域网)
EXPOSE 18900 18901
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.OFM_ADMIN_PORT||18900)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/entrypoint.sh"]
CMD ["--lan", "--lan-port", "18901", "--data-dir", "/data"]

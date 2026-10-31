# our-free-model-docker

把 [dsh-our-free-model](https://github.com/Ebony-Vinyl/dsh-our-free-model) 以 **Docker 容器独立运行** 的改造仓库。

拓扑：`Docker 容器 → 独立 dsh-our-free-model → 网关(/v1/*) → 上游模型`

## 许可证
上游为 **MIT**。镜像随分发携带 `LICENSE`、`vendor/channel-pack/{LICENSE,NOTICE.md}`、
`vendor/magpie/{LICENSE,NOTICE.md}`、`scripts/standalone-third-party.txt`（MIT 要求保留声明）。

## 版本号约定
`v{上游}.docker.{批次}`，例 **`v2.7.4-docker-0.1`**：
- `2.7.4` **跟随上游版本**（构建时自动读取上游 `packages/standalone/package.json` 的 `version`，无需手填）；
- `docker-0.1` 为本仓库的 Docker 改造批次，改造递增、上游升级重置。
- 上游版本由 `build.sh` 自动取得（可用 `UPSTREAM_REF` 锁定到具体 tag 以复现）。

## 策略（策略一：LAN 推理中继）
LAN 推理中继（`--lan --lan-port 18901`，监听 `0.0.0.0`，仅转发推理）对外暴露为网关；
管理页与本机 API 留 `loopback:18900`（容器内访问 / 临时端口转发）。
> 策略二（源码补丁放宽 loopback 暴露管理页）见 PLAN.md 第六章，MIT 允许但改动安全关键代码，本期不采用。

## 上游代码引入与「排除 DSH 依赖」做法
- 构建期 `git clone --depth 1` 浅克隆上游（默认 `main`，可 `UPSTREAM_REF` 锁定到 release tag）。
- **排除 DSH 依赖的正确做法**：直接调用上游自带的打包清单
  `scripts/pack-standalone.mjs → standaloneSourceFiles()`，把「独立服务真正需要的精确文件」复制到运行镜像。
  DSH 内核耦合的插件代码本就不在该清单内，因此自动排除，且随上游同步、不会漏拷也不会多拷。

## 构建
```sh
./build.sh                       # 默认 UPSTREAM_REF=main, 自动取上游版本, 批次 0.1
UPSTREAM_REF=2.7.4 ./build.sh    # 锁定上游 tag 2.7.4, 复现可构建
BATCH=0.2 ./build.sh             # 同一上游, 新批次
```
构建时从上游 GitHub 浅克隆，运行时零 npm 依赖（仅 Node 内置 + 清单 JS + 一个 WASM）。

## 运行
```sh
# 长期: 仅暴露 LAN 网关 18901
docker run -d --name ofm \
  -p 18901:18901 \
  -v ofm-data:/data \
  our-free-model:latest

# 首跑: 临时多开 18900 从宿主访问管理页, 登录并生成 LAN Key 后改用上面那条
docker run -d --name ofm-setup \
  -p 18900:18900 -p 18901:18901 \
  -v ofm-data:/data \
  our-free-model:latest
```
- `18901`：LAN 推理中继（网关，对外）= OpenAI 兼容 `/v1/chat/completions` 等，用独立 **LAN Key**。
- `18900`：管理/本机 API（loopback）。首跑临时 `-p 18900:18900` 打开管理页登录、生成 LAN Key；之后不再暴露。
- `/data`：持久化 `settings.json`(含 `forwardKey`/`standaloneLanKey`)、渠道凭据、用量。

首跑查看一次性登录链接：`docker logs ofm-setup`（10 分钟内有效，仅可兑换一次）。

## 客户端接入（网关）
下游（原 dsh 或其它 OpenAI 兼容客户端）指向 `http://<宿主IP>:18901/v1`，
Authorization: `Bearer <LAN Key>`（在管理页 `API 接入` 查看 / 轮换）。

## 文档
完整方案与维护策略见 [`PLAN.md`](./PLAN.md)。

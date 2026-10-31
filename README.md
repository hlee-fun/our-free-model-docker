# our-free-model-docker

把 [dsh-our-free-model](https://github.com/Ebony-Vinyl/dsh-our-free-model) 以 **Docker 容器独立运行** 的改造仓库。

拓扑：`Docker 容器 → 独立 dsh-our-free-model → 网关(/v1/*) → 上游模型`

## 许可证
上游为 **MIT**。本镜像随分发携带 `LICENSE`、`vendor/channel-pack/{LICENSE,NOTICE.md}`、
`vendor/magpie/{LICENSE,NOTICE.md}`、`scripts/standalone-third-party.txt`（MIT 要求保留声明）。

## 版本号约定
`v{上游}.docker.{批次}`，例 **`v2.7.4-docker-0.1`**：
- `2.7.4` 跟随上游项目 release tag；
- `docker-0.1` 为本仓库的 Docker 改造批次，改造递增、上游升级重置。

## 策略（当前：策略一）
LAN 推理中继（`--lan --lan-port 18901`，监听 `0.0.0.0`，仅转发推理）对外暴露网关；
管理页与本机 API 留 `loopback:18900`（容器内访问 / 临时端口转发）。

> 策略二（源码补丁放宽 loopback 暴露管理页）见 PLAN.md 第六章，MIT 允许但改动安全关键代码。

## 构建
```sh
./build.sh 2.7.4 0.1        # -> our-free-model:v2.7.4-docker-0.1
# 或
docker build --build-arg UPSTREAM_TAG=2.7.4 -t our-free-model:v2.7.4-docker-0.1 .
```
构建时从上游 GitHub 锁定 tag 浅克隆，运行时零 npm 依赖。

## 运行
```sh
docker run -d --name ofm \
  -p 18901:18901 \
  -v ofm-data:/data \
  our-free-model:v2.7.4-docker-0.1
```
- `18901`：LAN 推理中继（网关，对外）= OpenAI 兼容 `/v1/chat/completions` 等，用独立 LAN Key。
- `18900`：管理/本机 API（loopback）。首次配置可临时 `-p 18900:18900` 从宿主访问管理页登录、生成 LAN Key。
- `/data`：持久化 `settings.json`(含 `forwardKey`/`standaloneLanKey`)、渠道凭据、用量。

首跑查看一次性登录链接：`docker logs ofm`（10 分钟内有效，仅可兑换一次）。

## 待定事项（见 PLAN.md）
- 上游代码引入方式（当前用构建时浅克隆，备选 submodule/快照）
- 上游版本锁定 `2.7.4` 确认
- 策略一/二最终选择
- 构建期 `@deepseek-ai/*` 残留 import 校验（grep）

## 文档
完整方案与维护策略见 [`PLAN.md`](./PLAN.md)。

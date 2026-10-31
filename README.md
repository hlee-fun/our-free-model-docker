# our-free-model-docker

把上游 [dsh-our-free-model](https://github.com/Ebony-Vinyl/dsh-our-free-model) 以 **Docker 容器独立运行**的改造仓库。

拓扑：`容器 → 独立 dsh-our-free-model → 网关(/v1/*) → 上游模型`

## 上游归属

| 项 | 说明 |
|----|------|
| 上游项目 | [Ebony-Vinyl/dsh-our-free-model](https://github.com/Ebony-Vinyl/dsh-our-free-model) |
| 上游许可 | **MIT** |
| 本仓库 | 仅做容器化改造（Dockerfile / compose / 构建脚本），**不含上游源码**；构建时从上游浅克隆 |

镜像分发须保留上游 `LICENSE` 及第三方声明（`vendor/channel-pack/`、`vendor/magpie/`、`scripts/standalone-third-party.txt`）。

## 快速开始（Docker Compose）

纯远程拉取镜像，无本地构建、不依赖任何本地文件（数据用命名卷 `ofm-data`）。

```sh
# 1. 把 docker-compose.yml 里的 image 改成你的远程镜像（或运行时用 OFM_IMAGE 覆盖）
docker compose up -d
docker compose logs -f ofm   # 查看管理页登录链接 / 已放行的局域网主机
docker compose down          # 停止（卷保留）
```

默认 `network_mode: host`（管理页自动透传到局域网）；桥接网络改法见 compose 文件注释。

## 地址与端口

| 用途 | 地址 | 鉴权 |
|------|------|------|
| 网关（客户端用） | `http://<宿主IP>:18901/v1` | `Authorization: Bearer <LAN Key>` |
| 管理页 | `http://<宿主IP>:18900` | 登录框「令牌」填 **Management Key** |

- 两个 Key 用途**不互通**：LAN Key 只给 18901 网关，Management Key 只给 18900 登录。
- 两者都在 `/data/settings.json`（`standaloneLanKey` / `managementKey`）；首次登录链接见 `docker logs`。
- 端口只是默认值，可用 `OFM_ADMIN_PORT` / `OFM_LAN_PORT` 改。

## 常用环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `OUR_FREE_MODEL_FREE_TRANSPORT` | `node` | 容器内无 Bun 时推理会 502，此变量恢复旧传输层 |
| `OFM_TRUSTED_HOSTS` | 自动探测 | 放行访问管理页的主机（逗号分隔）；桥接网络需手动填宿主 IP |
| `OFM_ADMIN_PORT` / `OFM_LAN_PORT` | `18900` / `18901` | 管理端口 / 网关端口 |

## 构建镜像（可选）

```sh
BATCH=0.2 UPSTREAM_REF=2.7.4 ./build.sh   # 产出 our-free-model:v2.7.4-docker-0.2
```

版本号约定 `v{上游}.docker.{批次}`（上游版本由 `build.sh` 自动读取）。

## 说明

- 上游管理端口强制绑 `127.0.0.1`（issue #216，无 `--host`），镜像内置 `socat` 按局域网 IP 透传，并用 `OFM_TRUSTED_HOSTS` 放行 Host 围栏，使管理页可对局域网开放；未设置该变量时行为与上游完全一致。
- 免费车道推理额度由上游控制（可能返回 `429 Free usage limit reached`），与容器化无关。
- 本仓库的 `PLAN.md` 与本地测试文件不入库，仅存在于本地工作副本。

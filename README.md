# our-free-model-docker

把 [dsh-our-free-model](https://github.com/Ebony-Vinyl/dsh-our-free-model) 的 **独立模式（standalone）原样整合为 Docker 容器**。

> **内容无变更**：上游代码未被修改，本仓库只是把它打包成镜像，不含上游源码（构建时从上游浅克隆）。
> 唯一例外：`docker/patch-trust.mjs` 对 `src/trust.js` 加了一个开关，**仅在设置 `OFM_TRUSTED_HOSTS` 时生效**，不设置时与上游行为完全一致；`socat` 为镜像内附加组件，同样不改动上游代码。

## 上游归属

| 项 | 值 |
|----|----|
| 项目 | [Ebony-Vinyl/dsh-our-free-model](https://github.com/Ebony-Vinyl/dsh-our-free-model) |
| 作者 | **Ebony-Vinyl** |
| 许可 | **MIT** |
| 锁定版本 | `2.7.4` |

镜像分发须保留上游 `LICENSE` 及第三方声明（`vendor/channel-pack/`、`vendor/magpie/`、`scripts/standalone-third-party.txt`）。

拓扑：`容器 → 独立 dsh-our-free-model → 网关(/v1/*) → 上游模型`

## 使用（Docker Compose）

纯远程拉取镜像，无本地构建、不依赖任何本地文件（数据存命名卷 `ofm-data`）。

```sh
# 先改 docker-compose.yml 里的 image 为你的远程镜像（或用 OFM_IMAGE 覆盖）
docker compose up -d
docker compose logs -f ofm   # 管理页登录链接 / 已放行的局域网主机
docker compose down          # 停止（卷保留）
```

## 地址与端口

| 用途 | 地址 | 鉴权 |
|------|------|------|
| 网关（客户端用） | `http://<宿主IP>:18901/v1` | `Authorization: Bearer <LAN Key>` |
| 管理页 | `http://<宿主IP>:18900` | 登录框「令牌」填 **Management Key** |

- 两个 Key **不互通**：LAN Key 只给 18901 网关，Management Key 只给 18900 登录；都在 `/data/settings.json`（`standaloneLanKey` / `managementKey`）。
- 端口为默认值，可用 `OFM_ADMIN_PORT` / `OFM_LAN_PORT` 改。
- 管理页默认只能本机访问（上游强制 loopback）；镜像用 socat 透传 + `OFM_TRUSTED_HOSTS` 放行，才对局域网开放。

## 环境变量（可选）

| 变量 | 默认 | 说明 |
|------|------|------|
| `OUR_FREE_MODEL_FREE_TRANSPORT` | `node` | 容器内无 Bun 时推理会 502，此变量恢复旧传输层 |
| `OFM_TRUSTED_HOSTS` | 自动探测 | 放行访问管理页的主机；桥接网络需手动填宿主 IP |
| `OFM_ADMIN_PORT` / `OFM_LAN_PORT` | `18900` / `18901` | 管理端口 / 网关端口 |

## 构建镜像（可选）

```sh
BATCH=0.2 UPSTREAM_REF=2.7.4 ./build.sh   # → our-free-model:v2.7.4-docker-0.2
```

版本号 `v{上游}.docker.{批次}`，上游版本由 `build.sh` 自动读取。

## 备注

- 免费车道额度由上游控制（可能返回 `429 Free usage limit reached`），与容器化无关。
- 本仓库的 `PLAN.md` 与本地测试文件不入库，仅存在于本地工作副本。

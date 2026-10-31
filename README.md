# our-free-model-docker

把 [dsh-our-free-model](https://github.com/Ebony-Vinyl/dsh-our-free-model) 的独立模式（standalone）**原样整合为 Docker 容器**，使其**可在局域网内被其他设备直接使用**。

> **免责声明**：本项目**仅对上游代码做原样整合与容器化打包**。上游的功能、内容、模型与服务质量**均与本人无关**，版权与责任归原作者所有；本仓库不包含上游源码，也未对其内容作任何修改。
>
> **内容无变更**：上游代码原样使用，仅在构建时从上游浅克隆后打包。
> 唯一例外：`docker/patch-trust.mjs` 对 `src/trust.js` 加了一个开关，**仅在设置 `OFM_TRUSTED_HOSTS` 时生效**（不设置时与上游行为完全一致）；`socat` 为镜像内附加组件，同样不改动上游代码。

## 上游归属

| 项 | 值 |
|----|----|
| 项目 | [Ebony-Vinyl/dsh-our-free-model](https://github.com/Ebony-Vinyl/dsh-our-free-model) |
| 作者 | **Ebony-Vinyl** |
| 许可 | **MIT** |
| 容器使用版本 | 上游 `2.7.4`（镜像 tag `v2.7.4-docker-0.2`） |

镜像分发须保留上游 `LICENSE` 及第三方声明（`vendor/channel-pack/`、`vendor/magpie/`、`scripts/standalone-third-party.txt`）。

## 局域网作用（本容器化的核心价值）

上游默认**管理页只能本机访问**（管理端口强制绑 `127.0.0.1`，无 `--host`，见上游 issue #216）。本镜像解决了这一点，使**同一局域网内的任意设备**都能直接使用：

| 用途 | 局域网地址 | 谁在用 | 鉴权 |
|------|-----------|--------|------|
| **网关** | `http://<宿主IP>:18901/v1` | 局域网内所有 OpenAI 兼容客户端 / 原 dsh | `Authorization: Bearer <LAN Key>` |
| **管理页** | `http://<宿主IP>:18900` | 局域网内任意设备的浏览器 | 登录框「令牌」填 **Management Key** |

- **网关**：上游本就监听 `0.0.0.0`，容器化后对局域网天然可用。
- **管理页**：上游绑死 loopback，局域网设备访问会 `10061`；镜像用 `socat` 按局域网 IP 透传，并用 `OFM_TRUSTED_HOSTS` 放行上游 Host 围栏（否则 `403`），才实现对局域网开放——**这是本镜像相对原项目的主要增强**。
- 两个 Key **不互通**：LAN Key 只给 18901 网关，Management Key 只给 18900 登录；都在 `/data/settings.json`（`standaloneLanKey` / `managementKey`）。
- 端口为默认值，可用 `OFM_ADMIN_PORT` / `OFM_LAN_PORT` 改。

## 使用（Docker Compose）

纯远程拉取镜像，无本地构建、不依赖任何本地文件（数据存命名卷 `ofm-data`）。

```sh
# 先改 docker-compose.yml 里的 image 为你的远程镜像（或用 OFM_IMAGE 覆盖）
docker compose up -d
docker compose logs -f ofm   # 管理页登录链接 / 已放行的局域网主机
docker compose down          # 停止（卷保留）
```

## 环境变量（可选）

| 变量 | 默认 | 说明 |
|------|------|------|
| `OUR_FREE_MODEL_FREE_TRANSPORT` | `node` | 容器内无 Bun 时推理会 502，此变量恢复旧传输层 |
| `OFM_TRUSTED_HOSTS` | 自动探测 | 放行访问管理页的主机；桥接网络需手动填宿主 IP |
| `OFM_ADMIN_PORT` / `OFM_LAN_PORT` | `18900` / `18901` | 管理端口 / 网关端口 |

## 备注

- 免费车道额度由上游控制（可能返回 `429 Free usage limit reached`），与容器化无关。
- 本仓库的 `PLAN.md` 与本地测试文件不入库，仅存在于本地工作副本。

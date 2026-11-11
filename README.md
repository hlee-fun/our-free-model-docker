# our-free-model-docker

**简体中文** | [English](README-en.md)

把 [dsh-our-free-model](https://github.com/Ebony-Vinyl/dsh-our-free-model) 的独立模式（standalone）**原样整合为 Docker 容器**，使其**可在局域网内被其他设备直接使用**。

> **免责声明**：本项目**仅对上游代码做原样整合与容器化打包**。上游的功能、内容、模型与服务质量**均与本人无关**，版权与责任归原作者所有；本仓库不包含上游源码，也未对其内容作任何修改。
>
> **内容无变更**：上游代码原样使用，仅在构建时从上游浅克隆后打包。  
> 仅三处极小补丁（均可在不设置对应环境变量时退回上游原行为，不构成功能修改）：
>
> - `docker/patch-trust.mjs` 对 `src/trust.js` 加了一个 `OFM_TRUSTED_HOSTS` 开关，放行局域网 Host 围栏（否则管理页 `403`）；
> - `docker/patch-baseurl.mjs` 让管理页 `/api/management/summary` 按**请求实际 Host 头**回写 `baseUrl`，修复局域网访问时前端拿到的 API 基地址写死为 `127.0.0.1` 导致「API/跳转仍是本机回环、页面打不开」的问题（地址自动获取，非固定值）。
> - `docker/patch-lan-login.mjs` 让 EAC router 下各类「添加账号」登录流（临时 OAuth 回调服务，如 Loomy 微信 / Trae / LobsterAI / Raccoon / Carrier）的**绑定地址与对外 URL** 改用 `OFM_LAN_IP`（entrypoint 自动探测宿主局域网主 IP，或手动覆盖），修复局域网设备浏览器打开 `http://127.0.0.1:<port>/...` 时指向自己本机、连不到宿主的问题。**TRAE 同样适用**：默认即把 `auth_callback_url` 改成 `http://<LAN_IP>:<port>/authorize` 并把回调服务绑 `0.0.0.0`，故**局域网内任意机器**都能完成 TRAE 登录（已实测 trae.cn 接受非 loopback 回调），无需每人配 SSH 隧道。公网发布时再设 `OFM_CALLBACK_HOST`(域名)+`OFM_CALLBACK_SECURE`(1) 经 frp/反代桥接；仍可由 `OFM_CALLBACK_HOST=127.0.0.1` 强制回退 loopback（同机可用）。未设置任何回调变量时行为与上游完全一致。
>   `socat` 为镜像内附加组件，同样不改动上游代码。

## 上游归属

| 项      | 值                                                                                   |
| ------ | ----------------------------------------------------------------------------------- |
| 项目     | [Ebony-Vinyl/dsh-our-free-model](https://github.com/Ebony-Vinyl/dsh-our-free-model) |
| 作者     | **Ebony-Vinyl**                                                                     |
| 许可     | **MIT**                                                                             |
| 容器使用版本 | 上游 `2.7.1`（standalone 版本线；镜像 `ghcr.io/hlee-fun/our-free-model:latest`） |

镜像分发须保留上游 `LICENSE` 及第三方声明（`vendor/channel-pack/`、`vendor/magpie/`、`scripts/standalone-third-party.txt`）。

## 局域网作用（本容器化的核心价值）

上游默认**管理页只能本机访问**（管理端口强制绑 `127.0.0.1`，无 `--host`，见上游 issue #216）。本镜像解决了这一点，使**同一局域网内的任意设备**都能直接使用：

| 用途      | 局域网地址                    | 谁在用                         | 鉴权                                |
| ------- | ------------------------ | --------------------------- | --------------------------------- |
| **网关**  | `http://<宿主IP>:18901/v1` | 局域网内所有 OpenAI 兼容客户端 / 原 dsh | `Authorization: Bearer <LAN Key>` |
| **管理页** | `http://<宿主IP>:18900`    | 局域网内任意设备的浏览器                | 登录框「令牌」填 **Management Key**       |

- **网关**：上游本就监听 `0.0.0.0`，容器化后对局域网天然可用。
- **管理页**：上游绑死 loopback，局域网设备访问会 `10061`；镜像用 `socat` 按局域网 IP **自动探测并透传**（IP 由 `hostname -I` 实时获取，非写死），并用 `OFM_TRUSTED_HOSTS` 放行上游 Host 围栏（否则 `403`）；同时 `patch-baseurl.mjs` 让管理页 API 基地址随访问地址自动回写，避免前端把请求/跳转发回来访者自己的 `127.0.0.1`——**这是本镜像相对原项目的主要增强**。
- **EAC router「添加账号」登录**：在管理页里给各渠道（Loomy 微信 / Trae / LobsterAI / Raccoon / Carrier 等）添加账号时，上游会在本机起一个临时 OAuth 回调服务，并把回调地址写死成 `http://127.0.0.1:<随机端口>/...`。局域网设备浏览器打开该链接会指向自己本机、连不到宿主，登录无法进行。`patch-lan-login.mjs` 让这些回调服务的**绑定地址与对外 URL** 改用 `OFM_LAN_IP`（entrypoint 自动探测宿主局域网主 IP，或由你手动指定），使局域网设备能正常完成登录。**地址自动获取，非固定值。**
- 两个 Key **不互通**：LAN Key 只给 18901 网关，Management Key 只给 18900 登录；都在 `/data/settings.json`（`standaloneLanKey` / `managementKey`）。
- 端口为默认值，可用 `OFM_ADMIN_PORT` / `OFM_LAN_PORT` 改。

## 使用（Docker Compose）

纯远程拉取镜像，无本地构建、不依赖任何本地文件（数据存命名卷 `ofm-data`）。

```sh
# 镜像地址已内置（换镜像用 OFM_IMAGE=<镜像> 覆盖）
docker compose up -d
docker compose logs -f ofm   # 管理页登录链接 / 已放行的局域网主机
docker compose down          # 停止（卷保留）
```

## 首次使用：获取你自己的两个 Key

**镜像不含任何 Key**（`/data` 为卷，首次启动才随机生成），因此**每台部署的 Key 都不同、且只有你自己的容器里才有**：

- 分发镜像**不会**泄露 Key；
- 也**无法**由镜像作者预先告知具体值——请在自己的容器启动后读取。

```sh
# 方式1：管理页一次性登录链接（首启 10 分钟内有效，仅可兑换一次）
docker compose logs ofm | grep -i login

# 方式2：直接读取（最稳，随时可用）
docker exec ofm node -e 'const j=JSON.parse(require("fs").readFileSync("/data/settings.json","utf8"));console.log("LAN Key:",j.standaloneLanKey);console.log("Management Key:",j.managementKey)'
```

LAN Key 也可在管理页「API 接入」查看 / 轮换；`Management Key` 无轮换接口，需按需要改 `/data/settings.json`（停容器后以 root 改写，值须非空且不同于 `forwardKey`，否则会被重新随机）。

> 服务开放后 Key 即唯一鉴权：请定期轮换 LAN Key，并避免把管理页 `18900` 直接暴露到公网。

## 环境变量（可选）

| 变量                                | 默认                           | 说明                                                 |
| --------------------------------- | ---------------------------- | -------------------------------------------------- |
| `OUR_FREE_MODEL_FREE_TRANSPORT`   | `node`                       | 容器内无 Bun 时推理会 502，此变量恢复旧传输层                        |
| `OFM_TRUSTED_HOSTS`               | 自动探测                         | 放行访问管理页的主机；桥接网络需手动填宿主 IP                           |
| `OFM_LAN_IP`                      | 自动探测（首个非 docker 网桥的局域网 IPv4） | EAC router「添加账号」登录回调**绑定地址与默认回调 URL host**（含 TRAE）；手动指定可覆盖自动探测（如多网卡场景） |
| `OFM_CALLBACK_HOST`              | 未设（回退 `OFM_LAN_IP`）          | 覆盖登录回调 URL 的 host；跨网段 / 公网发布时填客户端实际可路由到的地址（如内网主机名、frp 公网域名）；设为 `127.0.0.1` 可强制 TRAE 回退 loopback |
| `OFM_CALLBACK_PORT`              | 未设（回退运行时监听端口）            | 覆盖登录回调 URL 的端口；frp / 反向代理改端口映射时填写                         |
| `OFM_CALLBACK_SECURE`            | 未设（http）                       | 设 `1`/`true` 则回调 URL 用 `https`（公网发布必需，trae.cn 对非 loopback 回调通常要求 https；纯局域网用 http 即可） |
| `OFM_TRAE_CALLBACK_PORT`         | 未设（18080）                      | 仅 TRAE：覆盖其回调服务监听端口；该端口常被 ofm 主服务占用导致随机回退，发布时建议显式指定一个空闲端口供 frp 固定映射 |
| `OFM_ADMIN_PORT` / `OFM_LAN_PORT` | `18900` / `18901`            | 管理端口 / 网关端口                                        |

## 备注

- 免费车道额度由上游控制（可能返回 `429 Free usage limit reached`），与容器化无关。
- **页脚版本显示 `2.7.1` 是该独立（standalone）版本的最后更新版本**：管理页页脚读取的是子包 `packages/standalone/package.json` 的 `version` 字段（独立版本线，最后更新到 `2.7.1`）；它与根 `package.json` 的版本（插件线，当前 `2.8.0`）是两条不同的版本线，**并非同一版本**。因此页脚显示 `2.7.1` 属正常，与容器化无关，本镜像亦未改动上游内容（坚持「原样整合」）。
- **模型工作台提示 `Magpie engine binary is unavailable` 是上游限制**：上游 `vendor/magpie/engine.json` 仅提供 `win32-x64` 平台的引擎二进制，Linux 容器（包括本镜像）下 `status().available` 恒为 `false`，故模型工作台里 Magpie 引擎显示不可用。**这是上游平台支持范围问题，非容器化导致**；本仓库坚持「原样整合」、不编译注入任何二进制，故不会绕过该限制。若需使用 Magpie，请在 Windows 宿主上直接运行上游原版。

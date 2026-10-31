# 本地容器测试环境 (local-test)

用于在本机目视/接口测试 `our-free-model` 独立网关。**固定 LAN Key + 持久数据卷**，
保证所有本地测试复用同一网关鉴权值，无需每次重新生成。

## 一键启动

```sh
./local-test/start-local.sh
```

- 容器名 `ofm`，`--network host` + 持久绑定 `local-test/data:/data`
- 首次启动会自动注入固定 LAN Key 后重启；之后直接复用

## 访问地址

| 用途 | 地址 | 鉴权 |
|------|------|------|
| **网关（对外 / 局域网）** | `http://127.0.0.1:18901/v1` 或 `http://<宿主IP>:18901/v1` | `Authorization: Bearer <固定 LAN Key>` |
| **管理页（本机 / 局域网）** | `http://127.0.0.1:18900` 或 `http://<宿主IP>:18900` | 登录页「令牌」框粘贴 `<Management Key>` |

> 管理页上游强制绑定 loopback；镜像用 `socat` 把它透传到局域网 IP，
> 并用 `OFM_TRUSTED_HOSTS` 放行局域网 Host（见下节），故局域网设备现在可直接打开管理页。

## 🌐 局域网使用（其他机器 / 跨机访问）

**网关和管理页现在都对局域网开放，不用"切换"，直接用 LAN IP 即可：**

| 项目 | 值 |
|------|-----|
| 客户端 Base URL（网关） | `http://<宿主IP>:18901/v1` |
| 网关鉴权 | `Authorization: Bearer LANKEY-local-fixed-2026-00000001` |
| 管理页 | `http://<宿主IP>:18900`（粘贴 Management Key 登录） |

- 网关监听 `0.0.0.0:18901`，**LAN IP 可达**（实测 `<宿主IP>:18901/v1/models` → 200）。
- 管理页经 `socat` 透传 + `OFM_TRUSTED_HOSTS` 放行，**LAN IP 可达**（实测 `<宿主IP>:18900/` → 200，登录 `/session` → 200）。
- 实测四项：`<宿主IP>:18900` = 200、`127.0.0.1:18900` = 200、`<宿主IP>:18901` +Key = 200、无 Key = 401。

**管理页开放到局域网的实现（两道关卡，均已解决）：**
1. **连不上（原 10061）**：管理端口上游强制绑 `127.0.0.1`，LAN IP 无监听。
   → 容器内 `socat` 对每个非 loopback IPv4 做纯 TCP 转发 `<LAN_IP>:18900 → 127.0.0.1:18900`。
   （注意：socat 只绑具体 LAN IP，**不能绑 `0.0.0.0`**——那会与 app 的 `127.0.0.1:18900` 冲突导致 EADDRINUSE。）
2. **连上后被 403**：上游 `src/trust.js` 的 Host 信任围栏要求 Host 必须是 loopback 名。
   → 构建期 `docker/patch-trust.mjs` 给围栏加 `OFM_TRUSTED_HOSTS` 开关；入口脚本自动把探测到的
   局域网 IP 填入（日志可见 `已放行局域网主机: OFM_TRUSTED_HOSTS=<宿主IP>`）。
   未设置该变量时行为与上游完全一致（仍只信任 loopback）。

> 若局域网 IP 变更：重启容器即可（入口脚本每次启动重新探测 IP 并重设 socat 与 `OFM_TRUSTED_HOSTS`）。
> 想退回"仅本机管理"：不设置 `OFM_TRUSTED_HOSTS` 即可（或去掉 socat 转发）。

## ⚠️ 两个 Key 用途不同，别混（常见"Key 不行"根因）

| Key | 用途 | 怎么拿到 |
|-----|------|----------|
| **固定 LAN Key** | **仅**网关 `18901` 的 OpenAI 兼容 API（`/v1/models`、`/v1/chat/completions`…） | `local-test/lankey.txt`；`start-local.sh` 启动后打印 |
| **Management Key** | **仅**管理页 `18900` 登录（粘贴进登录框"令牌"字段） | `settings.json` 的 `managementKey`；`start-local.sh` 启动后打印 |

- 管理页登录框**只认 `managementKey`（或 `forwardKey`）**，**不认 LAN Key**；用 LAN Key 登管理页必然失败。
- 管理页也可用启动日志里的一次性链接 `#login=...`（10 分钟有效），但 `managementKey` 更稳定、不过期。
- 取当前 Management Key：`docker exec ofm node -e 'console.log(JSON.parse(require("fs").readFileSync("/data/settings.json","utf8")).managementKey)'`

## 固定 LAN Key

```
LANKEY-local-fixed-2026-00000001
```

机制：上游 `service.mjs` 仅在 `standaloneLanKey` 为空或**等于 forwardKey** 时才重新随机生成；
注入一个「非空且 ≠ forwardKey」的固定值即被永久沿用（值存于 `local-test/data/settings.json`）。

- 文件记录：`local-test/lankey.txt`（gitignore，不入库）
- 换 Key：删除 `local-test/data/` 后重跑 `start-local.sh`，会自动写入同一固定值（可复现）

## 目视测试建议

1. **网关存活**：浏览器/客户端打 `http://127.0.0.1:18901/v1/models`（带 Bearer 固定 LAN Key）→ 应返回模型清单（200）。
2. **网关鉴权**：不带 Key 打同一地址 → 应 401。
3. **管理页登录**：浏览器开 `http://127.0.0.1:18900`，在"令牌"框粘贴 **Management Key**（启动脚本已打印），点击登录 → 进入查看渠道/车道状态、`API 接入` 中的 LAN Key。
   （备选：一次性链接 `docker restart ofm && docker logs ofm | grep -i login | tail -1` → 打开 `#login=...`）
4. **实际推理**：需上游传输层（Bun 或 `OUR_FREE_MODEL_FREE_TRANSPORT=node`，属上游运行时配置，与容器化无关）；
   经 `18901/v1/chat/completions` 用固定 LAN Key 发请求验证。

## 维护

- 停止：`docker stop ofm`
- 彻底重置（含换 Key）：`docker rm -f ofm && rm -rf local-test/data && ./local-test/start-local.sh`

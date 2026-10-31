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
| **网关（对外 / 局域网）** | `http://127.0.0.1:18901/v1` | `Authorization: Bearer <固定 LAN Key>` |
| **管理页（仅本机）** | `http://127.0.0.1:18900` | 登录页「令牌」框粘贴 `<Management Key>` |

> 管理页绑定容器内 `127.0.0.1`；`--network host` 让该 loopback 直接落到宿主，
> 因此浏览器可开 `http://127.0.0.1:18900`。普通 `-p` 端口映射反而连不上（已在 PLAN 标注）。

## 🌐 局域网使用（其他机器 / 跨机访问）

**网关（给客户端/下游用）已经对局域网开放，不用"切换"，直接换地址即可：**

| 项目 | 值 |
|------|-----|
| 客户端 Base URL | `http://<宿主IP>:18901/v1` |
| 鉴权 Header | `Authorization: Bearer LANKEY-local-fixed-2026-00000001` |
| 接口 | `/v1/models`、`/v1/chat/completions`、`/v1/responses`、`/v1/messages` |

- 网关监听 `0.0.0.0:18901`，**LAN IP 可达**（已实测 `<宿主IP>:18901/v1/models` → 200）。
- 用本机 `127.0.0.1` 还是 LAN IP `<宿主IP>` 都行，取决于客户端在哪台机器。

**⚠️ 为什么 `<宿主IP>:18900` / `:18900/v1` 报 10061（连接被拒）：**
- `18900` 是**管理端口**，上游 issue #216 强制绑定 `127.0.0.1`（loopback），**不在 LAN IP 上监听**，
  所以任何走 LAN IP（含宿主自身用 LAN IP 访问）的连接都被拒（客户端表现：10061 / Connection refused）。
- 而且 `/v1` 是**网关**路径，不在 18900 上。网关只在 **18901**。
- → 改用 `18901` + `/v1` + 固定 LAN Key 即可。

**管理页（`18900`）想从其他机器打开？** 因 loopback 限制，不能直连 LAN IP。两种办法：
1. **SSH 隧道**（推荐，不改源码）：在你要操作管理页的机器上执行
   `ssh -L 18900:127.0.0.1:18900 <user>@<宿主IP>`，然后本地浏览器开 `http://127.0.0.1:18900`。
2. 直接在**宿主本机**浏览器开 `http://127.0.0.1:18900`（已可达），粘贴 Management Key 登录。

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

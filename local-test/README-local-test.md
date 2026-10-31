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

| 用途 | 地址 | 说明 |
|------|------|------|
| **网关（对外 / 局域网）** | `http://127.0.0.1:18901/v1` | OpenAI 兼容；`Authorization: Bearer <固定 LAN Key>` |
| **管理页（仅本机）** | `http://127.0.0.1:18900` | `--network host` 下宿主 `127.0.0.1` 可达；需一次性登录链接 |

> 管理页绑定容器内 `127.0.0.1`；`--network host` 让该 loopback 直接落到宿主，
> 因此浏览器可开 `http://127.0.0.1:18900`。普通 `-p` 端口映射反而连不上（已在 PLAN 标注）。

## 固定 LAN Key

```
LANKEY-local-fixed-2026-00000001
```

机制：上游 `service.mjs` 仅在 `standaloneLanKey` 为空或**等于 forwardKey** 时才重新随机生成；
注入一个「非空且 ≠ forwardKey」的固定值即被永久沿用（值存于 `local-test/data/settings.json`）。

- 文件记录：`local-test/lankey.txt`（gitignore，不入库）
- 换 Key：删除 `local-test/data/` 后重跑 `start-local.sh`，会自动写入同一固定值（可复现）

## 目视测试建议

1. **网关存活**：浏览器/客户端打 `http://127.0.0.1:18901/v1/models`（带 Bearer 固定 Key）→ 应返回模型清单（200）。
2. **网关鉴权**：不带 Key 打同一地址 → 应 401。
3. **管理页**：`docker restart ofm && docker logs ofm | grep -i login | tail -1` 取一次性登录链接，
   浏览器打开 `http://127.0.0.1:18900/#login=...` 进入，查看渠道/车道状态、`API 接入` 中的 LAN Key。
4. **实际推理**：需上游传输层（Bun 或 `OUR_FREE_MODEL_FREE_TRANSPORT=node`，属上游运行时配置，与容器化无关）；
   经 `18901/v1/chat/completions` 用固定 Key 发请求验证。

## 维护

- 停止：`docker stop ofm`
- 彻底重置（含换 Key）：`docker rm -f ofm && rm -rf local-test/data && ./local-test/start-local.sh`

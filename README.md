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
服务有两个监听器，区别在**绑定地址**而非端口号：
- **管理/本机 API 监听器**：强制 `loopback`（issue #216 未实现远程管理，不支持 `--host`）。**注意**：因为绑定在容器内 `127.0.0.1`，宿主用 `-p 18900:18900` 映射**无法触达**（实测宿主探测 HTTP 000，仅容器内健康检查可达）。要在宿主访问管理页须用 `--network host`（仅 Linux），或全程用 `docker exec` 调用管理 API（推荐，见运行）。
- **LAN 推理中继**：显式 `--lan` 后额外监听 `0.0.0.0`，仅转发推理路径，用独立 LAN Key。

对外暴露的应是**后者（LAN 中继）**；前者（管理）不可对外。端口**数字只是默认值**，可随意改：
`--port` / `--lan-port` 改容器内监听号，`docker run -p <宿主>:<容器>` 再改宿主映射。默认用 `18900`(管理) / `18901`(LAN 中继) 仅为约定，非硬性要求。
> 注：dsh **插件**侧确有 5+ 处端口配置，但本容器跑的是**独立(standalone)模式**，只有上述两个监听器；插件侧的端口与本容器无关。
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
```

首跑配置（生成 LAN Key，**无需浏览器**，实测可用）：
管理监听器绑定容器内 loopback，宿主 `-p 18900` 映射连不上。正确做法是在容器内用管理 API 生成 LAN Key：
```sh
docker exec ofm node -e '
const fs=require("fs");
const s=JSON.parse(fs.readFileSync("/data/settings.json","utf8"));
const FK=s.forwardKey, base="http://127.0.0.1:18900";
const h={"Authorization":"Bearer "+FK,"Content-Type":"application/json"};
(async()=>{
  let j=await (await fetch(base+"/api/management/lan/key",{headers:h})).json().catch(()=>({}));
  if(!j.key) j=await (await fetch(base+"/api/management/lan/key/rotate",{method:"POST",headers:h,body:JSON.stringify({confirm:true})})).json().catch(()=>({}));
  console.log("LAN_KEY="+j.key);
})();
'
```
复制输出的 `LAN_KEY=...` 值，交给下游客户端即可。

若需在浏览器使用管理页：用 `--network host` 启动（仅 Linux），宿主开 `http://127.0.0.1:18900`（含 10 分钟内一次性登录链接，见 `docker logs ofm`）；配置完改回上面的桥接模式只暴露 18901。

- `18901`（默认，可改）：LAN 推理中继（网关，对外，绑定 `0.0.0.0`）= OpenAI 兼容 `/v1/chat/completions` 等，用独立 **LAN Key**。
- `18900`（默认，可改）：管理/本机 API（loopback，**宿主 `-p` 映射不可达**）。
- `/data`：持久化 `settings.json`(含 `forwardKey`/`standaloneLanKey`)、渠道凭据、用量。

## 客户端接入（网关）
下游（原 dsh 或其它 OpenAI 兼容客户端）指向 `http://<宿主IP>:18901/v1`，
Authorization: `Bearer <LAN Key>`（LAN Key 用上面 `docker exec` 命令生成 / 轮换）。

> 备注：实测 `/v1/models` 经 LAN Key 返回 200 与模型清单；免费车道实际推理需要上游传输层（Bun 或 `OUR_FREE_MODEL_FREE_TRANSPORT=node`），属上游运行时配置，与容器化无关。

## 本地测试环境 (local-test)

`local-test/` 提供一键可复用的本机测试环境：以 `--network host` 启动容器（管理页 `18900`
在宿主 `127.0.0.1` 直接可达，便于浏览器目视）、持久绑定 `local-test/data`、并自动注入**固定 LAN Key**
（`LANKEY-local-fixed-2026-00000001`），保证所有本地测试复用同一网关鉴权值。

```sh
./local-test/start-local.sh
```

网关：`http://127.0.0.1:18901/v1` + `Authorization: Bearer LANKEY-local-fixed-2026-00000001`。
详见 [`local-test/README-local-test.md`](./local-test/README-local-test.md)。

## 文档
完整方案与维护策略见 [`PLAN.md`](./PLAN.md)。

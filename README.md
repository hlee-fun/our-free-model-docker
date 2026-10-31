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

## 策略（策略一：LAN 推理中继 + 管理端口局域网透传）
服务有两个监听器，区别在**绑定地址**而非端口号：
- **管理/本机 API 监听器**：上游强制 `loopback`（issue #216 未实现远程管理，不支持 `--host`，绑定在 `127.0.0.1`）。**为使局域网其他设备也能打开管理页（你的明确需求），分两步解决：**
  1. `socat` 透传：镜像内置 socat，对每个检测到的非 loopback IPv4 做转发 `<LAN_IP>:18900 → 127.0.0.1:18900`。
     注意 socat **不能绑 `0.0.0.0`**（含 loopback，会与 app 的 `127.0.0.1:18900` 冲突导致 EADDRINUSE）。
  2. 放行 Host 围栏：上游 `src/trust.js` 要求管理请求 Host 必须是 loopback 名，否则 403；
     构建期 `docker/patch-trust.mjs` 给围栏加 `OFM_TRUSTED_HOSTS` 开关，入口脚本自动填入检测到的局域网 IP。
     未设置该环境变量时行为与上游完全一致（仍只信任 loopback）。
  管理页本身仍需 managementKey 登录。
- **依赖**：socat 与 `OFM_TRUSTED_HOSTS` 都靠"容器能看到宿主网络接口"自动得到局域网 IP，
  因此推荐 `--network host`（Linux，见 `docker-compose.yml`）。
  若必须用桥接网络，需自行 `-e OFM_TRUSTED_HOSTS=<宿主IP>` 并 `-p 18900:18900` 映射（此时自动探测到的是容器内网 IP，不生效）。
- **LAN 推理中继**：显式 `--lan` 后额外监听 `0.0.0.0`，仅转发推理路径，用独立 LAN Key。

对外暴露的应是**两者按需**：LAN 中继（18901）给下游客户端/网关调用；管理（18900，经 socat 透传）给需要跨设备管理的场景。端口**数字只是默认值**，可随意改：
`--port` / `--lan-port` 改容器内监听号，`docker run -p <宿主>:<容器>` 再改宿主映射。默认用 `18900`(管理) / `18901`(LAN 中继) 仅为约定，非硬性要求。
> 注：dsh **插件**侧确有 5+ 处端口配置，但本容器跑的是**独立(standalone)模式**，只有上述两个监听器；插件侧的端口与本容器无关。
> 策略二（直接源码补丁放宽 loopback）详见本地 `PLAN.md` 第六章（该文档不入库），MIT 允许但改动安全关键代码；本期改用等效且更安全的 **socat 透传** 实现同样效果，不采用策略二。

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

## 部署运行（Docker Compose · 推荐）
纯**远程拉取**镜像，无本地 build、不依赖任何本地文件（无 `env_file`、无宿主目录挂载，数据用命名卷 `ofm-data`）：
```sh
# 1) 编辑 docker-compose.yml, 把 image 默认值换成你的远程镜像
#    (也可不改文件: OFM_IMAGE=<你的镜像> docker compose up -d)
docker compose up -d
docker compose logs -f ofm      # 查看放行主机 / 管理页登录链接
docker compose down             # 停止(卷保留)
```
compose 内已默认 `network_mode: host`（socat 自动探测宿主局域网 IP）。
桥接网络的改法写在 `docker-compose.yml` 末尾注释里。

## 运行（docker run 等价写法）
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
- `18900`（默认，可改）：管理/本机 API。上游绑定 loopback，镜像用 `socat` 透传到 `0.0.0.0`，故**局域网设备现在可直接访问**（仍需 managementKey 登录）。
- `/data`：持久化 `settings.json`(含 `forwardKey`/`standaloneLanKey`)、渠道凭据、用量。

## 客户端接入（网关）
下游（原 dsh 或其它 OpenAI 兼容客户端）指向 `http://<宿主IP>:18901/v1`，
Authorization: `Bearer <LAN Key>`（LAN Key 用上面 `docker exec` 命令生成 / 轮换）。

> 备注：实测 `/v1/models` 经 LAN Key 返回 200 与模型清单；免费车道实际推理需要上游传输层（Bun 或 `OUR_FREE_MODEL_FREE_TRANSPORT=node`），属上游运行时配置，与容器化无关。

## 本地测试环境（不入库）

`local-test/` 是一键本机测试环境（`--network host` 启动、持久绑定 `local-test/data`、注入固定 LAN Key），
**仅存在于本地工作副本**：所有涉及 test 的文件与 `PLAN.md` 均已加入 `.gitignore`，不同步至 git。

## 文档
完整方案与维护策略见本地 `PLAN.md`（草案，不入库）。

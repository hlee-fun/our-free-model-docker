# dsh-our-free-model 容器化独立运行方案（草案 · 待评审）

> 目标：判断该项目能否以 Docker 容器形式独立运行，并给出落地方案。
> 原运行时：`dsh` → `dsh` 插件 `dsh-our-free-model` → 模型
> 设想拓扑：`Docker 容器` → `独立 dsh-our-free-model` → `网关` → `模型`
> 状态：**仅方案，未执行**（本文为评审稿，确认后再实现）。

---

## 一、可行性结论

**可以。** 该项目（v2.7.4，MIT 许可）已原生支持「脱离 dsh 独立运行」模式：

- 零运行时 npm 依赖，内置 OpenAI 兼容网关，完全满足设想拓扑。
- 唯一官方未覆盖的是「远程管理」（issue #216），可用 **LAN 中继** 或小幅 **MIT 允许的源码补丁** 绕过。

---

## 二、关键证据（来自仓库核查）

1. **许可证：MIT**（spdx `MIT`）。允许修改、再分发、商业化、私有使用；唯一义务是随分发保留版权与许可证声明。制作并分发容器镜像合规，但镜像须携带 LICENSE 及第三方声明。

2. **独立模式已成体系**
   - 入口 `packages/standalone/cli.mjs`（脚本 `start:standalone`），明确不依赖 dsh / Cordis / 宿主凭据。
   - 独立包 `our-free-model-standalone` 的 `package.json` **无 `@deepseek-ai/dsh-*` 运行时依赖**（仅有 React/Vite 等 devDependencies，仅用于构建前端）。
   - 打包清单 `scripts/pack-standalone.mjs` 的 `standaloneSourceFiles()` 列出「独立服务真正需要的精确文件」（`packages/standalone/*`、`src/<特定文件>.js`、`vendor/channel-pack/qoder-auth-wasm.wasm`、LICENSE 等）。DSH 内核耦合的**插件代码根本不在此清单内**——这才是独立路径与 dsh 解耦的实质。注：早期核查曾误记「清单排除 `src/adapter.js`」，实际 `src/adapter.js` 在清单中（为独立版 adapter，无 `@deepseek-ai/*` 依赖）；真正被排除的是插件包本身。本仓库 Dockerfile 直接调用该清单提取文件，自动排除 DSH 依赖且随上游同步。

3. **网关已内建**：独立服务提供 OpenAI 兼容推理 API —— `GET /v1/models`、`POST /v1/chat/completions`、`POST /v1/responses`、`POST /v1/messages`（含 Anthropic 形态）。这正是设想中的「网关」。

4. **LAN 中继（官方支持的容器暴露方式）**：`--lan --lan-port` 会额外起一个监听 `0.0.0.0` 的**推理中继**，仅转发模型清单与推理路径（不含管理页 / 管理 API），用独立的 LAN Key 鉴权。README 明确：「容器映射中继端口可供已配置的推理客户端连接」。

5. **官方缺口（issue #216）**：管理监听器与 Host 信任围栏**强制 loopback**，不支持 `--host` / `OFM_ALLOW_NON_LOOPBACK` / `OFM_TRUSTED_HOSTS`；无官方容器镜像，无容器内账号 OAuth 登录适配。

---

## 三、拓扑映射

| 原运行时 | 设想（容器） |
|---|---|
| `dsh`（宿主应用） | Docker 容器 |
| `dsh` 插件 `dsh-our-free-model` | 独立服务 `packages/standalone`（容器内运行，不再需要 dsh） |
| 模型（上游免费车道 / Kilo / 聚合渠道） | 同一套上游；容器内网关对外暴露 `/v1/*` |

> 原链路中「插件」依赖 dsh 内核提供的 `llm` 能力；独立模式下该能力由 `src/*.js`（forward / http / upstream 等）自带实现，故无需 dsh。

---

## 四、推荐容器拓扑（策略一：LAN 中继 · 官方支持、安全模型完整）

- 容器内启动：`node packages/standalone/cli.mjs --lan --lan-port 18901`，数据目录 `OFM_HOME=/data`。
- 端口分工：
  - `18900` 管理 + 本机 API（**绑定容器内 127.0.0.1**，宿主 `-p 18900:18900` 映射**实测不可达/HTTP 000**，仅容器内或 `--network host` 可访问）——**强制 loopback 是 issue #216 的硬约束，与端口数字无关**
  - `18901` LAN 推理中继（`0.0.0.0`，对外暴露 = 设想中的「网关」）——端口数字仅为默认，`--lan-port` / `-p` 可随意改
- 卷：`/data` 持久化 `settings.json`（含 `forwardKey`、`standaloneLanKey`、渠道开关）、`channel-credentials.json`、用量统计等。
- 首跑流程：临时 `docker run -p 18900:18900` 从宿主访问管理页 → 用容器 stdout 打印的 10 分钟内一次性登录链接登录 → 配置免费车道 / 聚合渠道并生成 LAN Key → 之后不再暴露 18900，仅映射 18901 给下游（原 dsh 或其它 OpenAI 兼容客户端）。

> 该策略与设想拓扑**完全吻合**：对外暴露的就是「网关（推理中继）」，管理留在容器内。

---

## 五、Dockerfile 草案（单阶段 · 零运行时 node_modules）

`packages/standalone/web/` 是仓库**已提交的构建产物**，服务直接加载，运行时无需安装 React/esbuild，故无需 builder 阶段（除非自行改前端）。

```dockerfile
FROM node:22-bookworm-slim            # 或 node:24-bookworm-slim，须满足 engines: ^22.19 || >=24
WORKDIR /app
ENV OFM_HOME=/data

# 仅复制独立运行所需文件（不含 .git / node_modules / 用户凭据）
COPY LICENSE ./LICENSE
COPY scripts/standalone-third-party.txt ./scripts/standalone-third-party.txt
COPY packages/standalone ./packages/standalone   # 含已提交的 web/ 构建产物
COPY src ./src
COPY vendor/channel-pack ./vendor/channel-pack
COPY vendor/magpie ./vendor/magpie

VOLUME ["/data"]
EXPOSE 18900 18901
ENTRYPOINT ["node", "packages/standalone/cli.mjs"]
CMD ["--lan", "--lan-port", "18901"]
```

- **许可证合规**：镜像须携带 `LICENSE`、`vendor/channel-pack/{LICENSE,NOTICE.md}`、`vendor/magpie/{LICENSE,NOTICE.md}`、`scripts/standalone-third-party.txt`（MIT 要求保留声明）。
- **零运行时依赖**：运行阶段不 `npm install`；服务仅用 Node 内置 + 上述 JS + 一个 WASM（`vendor/channel-pack/qoder-auth-wasm.wasm`，Node 原生加载，无需编译）。
- **校验步骤（实现前必做）**：`grep -rn "@deepseek-ai/" src packages/standalone` 确认独立路径无 dsh 内核 import；若残留，需在运行阶段安装对应 `@deepseek-ai/*` 或打补丁。
- **如需改前端**：加 builder 阶段（`npm ci` 根 + `npm ci --prefix packages/standalone`，再 `node scripts/build-standalone-ui.mjs`），从 builder 复制 `packages/standalone/web`。

---

## 六、备选策略（策略二：源码补丁暴露管理 · MIT 允许）

若需从容器外直接访问管理页，可在 `service.mjs` 增加 `OFM_BIND=0.0.0.0` 环境变量控制主监听器绑定，并放松 Host 信任围栏（仅放开网关路径，管理仍加锁）。
**代价**：改动安全关键代码、上游升级需重打补丁。**建议优先用策略一。**

---

## 七、风险与注意

1. **管理 loopback 限制（issue #216）**：官方未实现远程管理；策略一已规避，策略二需自行承担安全。
2. **EAC / 账号渠道 OAuth**：EAC 需 GitHub 登录 + star + 桌面指纹；账号渠道（Qoder / TRAE / 等）多有浏览器 / OAuth 登录，容器内 headless 难以完成。实际可用的是 **匿名免费车道 + 聚合渠道（用户自备 Key 存 settings.json）**。
3. **上游 ToS / 限速**：免费车道按 session 限速（429 后自动恢复）；Kilo 免费池提示词可能被上游记录，勿发敏感内容。容器化不违反 MIT，但需遵守上游使用条款。
4. **LAN Key ≠ 管理 Key**：中继用独立 LAN Key，且不转发管理数据；对外暴露 18901 时务必用防火墙 / 反向代理限制来源 IP。
5. **数据目录单实例**：同一 `OFM_HOME` 只能跑一个实例；异常退出残留 `service.lock` 需确认旧进程已停后手动删除。

---

## 八、版本号约定

采用 `v{上游}.docker.{批次}` 形式：

- `v2.7.4-docker-0.1` 中 **`2.7.4` 跟随上游项目版本**（dsh-our-free-model 的 release tag）；构建时由 `build.sh` 自动读取上游 `packages/standalone/package.json` 的 `version` 字段取得，无需手填；`UPSTREAM_REF` 可锁定到具体 tag（如 `2.7.4`）以复现。
- **`docker-0.1` 为本项目的「Docker 改造批次」**，`-0.1` 表示首次打包；后续每次对镜像 / 补丁 / Dockerfile / 说明的修改递增批次号（如 `-0.2`）；上游升级到新版本则重置批次从 `-0.1` 起（如 `v2.8.0-docker-0.1`）。
- 镜像 tag 与源码分支 / tag 同名，便于回溯。首个发布标签示例：**`v2.7.4-docker-0.1`**。

## 九、更新与维护策略（后续更新问题）

本项天然涉及「后续更新」，正式纳入方案：

1. **镜像化优先于容器内自更新**：独立服务自带应用内升级（SHA-256 校验 + 热重载），但容器文件系统 ephemeral，不应依赖容器内原地升级；每次上游发版以「拉新源码 → 重打镜像 → 新 tag」方式更新。
2. **上游版本跟随**：本地 git 跟踪上游 tag（如 `2.7.4`），更新时 `git fetch` 上游、切到新 tag / commit，重走构建流程，版本号按第八节递增批次。
3. **若采用策略二（源码补丁）**：将 loopback 放宽等改动以独立补丁文件（建议 `docker/` 目录下的 `*.patch` 或独立 fork 分支）维护，用 `git format-patch` / rebase 随上游新版本重放；构建脚本中自动 `git apply`，并记录所基于的上游 commit。
4. **若采用策略一（LAN 中继，无需改源码）**：更新只换源码与镜像 tag，无补丁重放负担——这是优先推荐策略一的运维理由之一。
5. **数据向后兼容**：`OFM_HOME` 卷跨版本保留；关注上游 `settings.json` schema 变更（README 注明不自动迁移 / 不覆盖），大版本升级前备份 `/data`。
6. **回滚**：保留历史镜像 tag，回滚即切回旧 tag + 旧 `/data` 备份。

## 十、Git 工作流（本项测试）

本项将使用 **本地 git** 与 **PNote 的 git**（测试）协同维护 Docker 改造源码、补丁与使用说明：

- **本地 git**：在 workspace（`/home/lee/文档/ofm`）建立仓库 / 分支，跟踪上游源码快照与我们的 `Dockerfile`、补丁、使用说明。
- **PNote 的 git**：远端 `https://hlee.fun/git/our-free-model-docker.git` 已建立并验证可读写（`main` 分支已推送骨架）。本地 `.git/config` 含访问 token（明文），建议后续改用 SSH 或凭据管理器。
- **建议目录**：`dsh-ofm-docker/`（含 `Dockerfile`、`docker/` 补丁、`README`、`.gitignore` 排除 `.git` / 凭据 / `node_modules`）。
- 版本标签按第八节规则（`v2.7.4-docker-0.1`）。

## 十一、决策记录与下一步（已确认）

用户已拍板以下 5 项，落地据此执行：

1. **上游引入方式**：构建时浅克隆（默认 `main`，可 `UPSTREAM_REF` 锁 tag）；且仅提取独立服务所需文件——通过上游自带 `standaloneSourceFiles()` 清单复制，排除 DSH 依赖部分。
2. **版本号**：跟随上游自动获取（build.sh 读 `package.json.version`），约定 `v{上游}.docker.{批次}`。
3. **暴露模型（非端口号决策）**：对外暴露的是 LAN 推理中继（绑定 `0.0.0.0`），管理监听器保持 loopback（issue #216 硬约束）。端口数字仅为默认（18900/18901），可经 `--port` / `--lan-port` 与 `docker run -p` 自由改；不把端口号当作架构决策。（dsh 插件侧 5+ 处端口属插件模式，与本独立容器无关。）
4. **策略**：采用策略一（LAN 中继），不改源码。
5. **验证**：采纳构建期 `grep @deepseek-ai/` 校验 + 首跑 `docker run` 验证网关。

下一步（已部分完成）：
1. ✅ 构建：本地 `UPSTREAM_REF=v2.7.4 BATCH=0.1 bash ./build.sh` 成功，镜像 `our-free-model:v2.7.4-docker-0.1`（提取 103 个独立文件，自动排除 DSH 插件包）。
2. ✅ 残留校验：`docker run --rm --entrypoint grep ... -rnE '(import|require)\b[^;]*@deepseek-ai/' /app/src /app/packages/standalone` → 无真正依赖引用（仅有 3 处 `business.mjs` 错误提示字符串提及，非 import）。
3. ✅ 首跑配置（已验证无头可用）：`docker run -d -p 18901:18901 -v ofm-data:/data --name ofm`，再用 `docker exec ofm node -e '{管理API读取forwardKey→轮换LAN Key}'` 生成 LAN Key（实测 36 位）；**管理 18900 绑定 loopback，宿主 `-p` 不可达**，故用 exec 而非浏览器。
4. ✅ 网关验证：宿主经 `18901` + LAN Key 调 `/v1/models` 返回 200 + 真实模型清单；无 key 返回 401。
5. 待办：免费车道实际推理需上游传输层（Bun 或 `OUR_FREE_MODEL_FREE_TRANSPORT=node`），属上游运行时配置，非容器化问题；推送更新到 `hlee.fun`。

### 实施 0.1 本地实测结论
- 镜像构建通过；独立服务启动正常，打印管理一次性登录链接与 LAN API 地址（容器标记 healthy）。
- **关键修正**：管理端口 `18900` 绑定容器内 `127.0.0.1`，宿主 `-p 18900:18900` 映射返回 HTTP 000（不可达）；容器内健康检查正常。故"首跑开管理页"须改用 `docker exec` 管理 API 或 `--network host`，不能靠 `-p` 映射。已同步修正 README/PLAN。
- 网关验证通过：LAN 中继 `18901`（0.0.0.0）用 LAN Key 调 `/v1/models` 返回 200 + 模型清单（`mimo-v2.6-flash-free` 等）；无 key 返回 401。
- 排除 DSH 依赖真正生效：上游独立路径无任何 `@deepseek-ai/*` import/require。
- 注意镜像内 `service.version` 打印为子包版本（如 2.7.1），而镜像 tag 用项目根版本（2.7.4），两者命名空间不同，属正常。

---

### 参考（已核查的仓库事实）
- `package.json`：version 2.7.4，engines `^22.19.0 || >=24.0.0`，license MIT，peerDependencies 均为 `@deepseek-ai/*`（仅插件模式需要）。
- `packages/standalone/package.json`：name `our-free-model-standalone`，**无运行时依赖**。
- `scripts/pack-standalone.mjs`：`standaloneSourceFiles()` 给出独立服务精确文件清单（含 `src/adapter.js` 独立版）；DSH 耦合的插件代码不在清单内。本仓库构建期直接调用该清单提取文件。
- `packages/standalone/cli.mjs`：支持 `--port / --data-dir / --lan / --lan-port / --no-refresh`，无 `--host`。
- `packages/standalone/README.md`：明确 issue #216（Docker 远程管理）未实现，LAN 中继为官方支持的容器推理接入方式。

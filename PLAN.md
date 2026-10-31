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
   - 打包清单 `scripts/pack-standalone.mjs` 刻意**排除** `adapter/` 与 `src/adapter.js`（那是唯一允许 `import @deepseek-ai/*` 的位置），证明独立路径已与 dsh 内核解耦。

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
  - `18900` 管理 + 本机 API（loopback，仅容器内或临时端口转发访问，**不对外暴露**）
  - `18901` LAN 推理中继（`0.0.0.0`，对外暴露 = 设想中的「网关」）
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

- `v2.7.4-docker-0.1` 中 **`2.7.4` 跟随上游项目版本**（dsh-our-free-model 的 release tag）；
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
- **PNote 的 git**：作为测试 / 镜像同步的另一远端，验证跨仓库推送与回溯（实际 remote 待提供）。
- **建议目录**：`dsh-ofm-docker/`（含 `Dockerfile`、`docker/` 补丁、`README`、`.gitignore` 排除 `.git` / 凭据 / `node_modules`）。
- 版本标签按第八节规则（`v2.7.4-docker-0.1`）。

## 十一、待确认 / 批准后执行的下一步

1. 拉取上游仓库并切到指定 release tag（如 `2.7.4`），在 `dsh-ofm-docker/` 子目录纳入本地 git 跟踪（第十节）。
2. 验证独立路径无 dsh 依赖（grep）+ 本地 `npm run start:standalone` 跑通。
3. 按策略一编写并构建镜像（多阶段可选）。
4. 本地 `docker run` 验证：管理页登录 → 生成 LAN Key → 外部客户端经 `18901` 调用 `/v1/chat/completions` 成功。
5. 产出可复用镜像（tag `v2.7.4-docker-0.1`）+ 使用说明（含许可证归属与上游 ToS 提示）；按第十节推送到本地 git 与 PNote 的 git（测试）。

---

### 参考（已核查的仓库事实）
- `package.json`：version 2.7.4，engines `^22.19.0 || >=24.0.0`，license MIT，peerDependencies 均为 `@deepseek-ai/*`（仅插件模式需要）。
- `packages/standalone/package.json`：name `our-free-model-standalone`，**无运行时依赖**。
- `scripts/pack-standalone.mjs`：sourceFiles 刻意排除 `adapter/` 与 `src/adapter.js`。
- `packages/standalone/cli.mjs`：支持 `--port / --data-dir / --lan / --lan-port / --no-refresh`，无 `--host`。
- `packages/standalone/README.md`：明确 issue #216（Docker 远程管理）未实现，LAN 中继为官方支持的容器推理接入方式。

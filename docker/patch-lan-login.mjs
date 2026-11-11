// docker/patch-lan-login.mjs
// 修复 EAC router 下各类「添加账号」登录流程在局域网 / 公网下把回调地址写死成
// http://127.0.0.1:<port> 的问题（Loomy 微信 / Trae / LobsterAI / Raccoon / Carrier 等）。
//
// 上游这些登录流会在本机起一个临时 OAuth 回调服务，并把
//   - 服务绑定地址写死 server.listen(<port>, "127.0.0.1")
//   - 对外展示/发给服务商的回调 URL 写死 http://127.0.0.1:<port>/...
// 局域网其他设备 / 公网用户打开该链接时，127.0.0.1 指向的是设备自己，连不到宿主，登录无法进行。
//
// 补丁：把绑定地址与 URL 中的 127.0.0.1 改为运行时环境变量。
//   - 未设置相关变量时 → 行为与上游完全一致（127.0.0.1），本机登录不受影响。
//   - 设置后（由 entrypoint 自动探测宿主局域网主 IP，或手动覆盖）→ 局域网/公网设备可正常使用。
//
// 渠道差异（关键）：
//   - Loomy 微信 / LobsterAI / Raccoon / Carrier 等是「网页 / 服务端中继」回调，需要回调地址
//     对发起登录的设备可达，故把 127.0.0.1 改成 OFM_LAN_IP（或 OFM_CALLBACK_*）即可在多设备
//     / 跨网段下使用。
//   - TRAE 的 native_ide 登录：**默认保持 loopback（上游行为）**。实测（2026-11-11，见
//     日志）：http://LAN_IP 回调在 trae.cn「授权完成」环节失效——授权页能开（HTTP 200），
//     但点授权后令牌只向 loopback 投放；https 授权页跳转 http://LAN_IP 会被浏览器升级成
//     https / 拦为混合内容，令牌永远到不了回调（服务端表现为「TRAE 登录超时」）。
//     局域网 / 公网请设 OFM_CALLBACK_HOST(域名) + OFM_CALLBACK_SECURE(1) 切换为 **https 域名
//     回调**（公网 frp 桥接，或纯局域网用 DNS-01 真证书 + 内网 DNS），此时回调服务绑 0.0.0.0。
//
// 远程 / 跨网段访问（经 frp 或内网多子网）：
//   - OFM_CALLBACK_URL（可选，最高优先级）：回调 URL 的完整 base（含 scheme + host，
//     可选 :port），如 https://ofm.example.com。设了它则直接用作回调前缀，原端口不再追加。
//   - OFM_CALLBACK_HOST / OFM_CALLBACK_PORT（可选）：覆盖 host / 端口；scheme 由
//     OFM_CALLBACK_SECURE 决定（设 "1"/"true" 则 https，否则 http）。
//   - OFM_CALLBACK_SECURE（可选）：1/true → 回调 URL 用 https（公网发布必需，trae.cn 对非
//     loopback 回调通常要求 https）。
//   - OFM_TRAE_CALLBACK_PORT（可选，仅 TRAE）：覆盖 TRAE 回调服务监听端口（默认 18080；
//     该端口常被 ofm 主服务占用导致随机回退，发布时建议显式指定一个空闲端口供 frp 固定映射）。
//
// 仅改动绑定 host 与对外 URL 模板，不触碰内部请求解析与桌面端 Chrome DevTools 地址。
//
// 0.11 追加（2026-11-11）：TRAE 手动回调投递。
//   背景（当日实测闭环）：trae.cn 授权页从 https 页面用页面 JS 投递令牌——http://LAN_IP
//   被浏览器混合内容拦截、https 需浏览器信任的证书（纯局域网无域名 ⇒ 物理不可得），
//   故跨机器场景令牌只会落在使用者自己浏览器的 127.0.0.1。
//   解法：管理页新增「TRAE 登录助手」悬浮面板，使用者把授权后地址栏的完整回调 URL
//   粘贴进去 → 新增 RPC `login.submitCallback` 由 ofm 在本机转发给待处理的回调服务
//   （完整复用上游 解析→兑换→入账→login.poll 链路），流程 = 添加账号→授权→粘贴→完成。
//   安全：仅接受 http://127.0.0.1|localhost|[::1] 的 /authorize 路径（防 SSRF），
//   且要求 URL 携带令牌参数才转发（避免一次误粘贴白白消耗掉本次登录尝试）。

import fs from 'node:fs';

const file = '/app/packages/standalone/channels/business.mjs';
const marker = '/* OFM-LAN-LOGIN-PATCH */';

let src = fs.readFileSync(file, 'utf8');
if (src.includes(marker)) {
  console.log('[patch-lan-login] 已打过补丁，跳过');
  process.exit(0);
}

// ───────────────────────── TRAE native_ide（先于通用替换，避免被 urlRe/bindRe 误改） ─────────────────────────
// 默认保持 loopback（同机浏览器可用，安全）；仅当 OFM_CALLBACK_HOST 显式设置时切换为公网回调。

// TRAE 回调端口可配置：避开与主服务 18080 冲突 + 给 frp 固定映射
src = src.replace(
  /var TRAE_CALLBACK_PORT = 18080;/g,
  'var TRAE_CALLBACK_PORT = process.env.OFM_TRAE_CALLBACK_PORT ? Number(process.env.OFM_TRAE_CALLBACK_PORT) : 18080;'
);

// TRAE 绑定地址：仅当 OFM_CALLBACK_HOST（https 域名回调）设置时绑 0.0.0.0（供 frp / 反代桥接），
// 否则保持上游 127.0.0.1（loopback）。LAN_IP 默认已实测证伪（trae.cn 令牌只投放 loopback）。
src = src.replace(
  /server\.listen\(port,\s*"127\.0\.0\.1",\s*\(\s*\)\s*=>/g,
  'server.listen(port, (process.env.OFM_CALLBACK_HOST ? "0.0.0.0" : "127.0.0.1"), () =>'
);

// TRAE 两处 callbackUrl：默认 loopback（上游行为）；设 OFM_CALLBACK_HOST(+SECURE) 时切 https 域名回调。
src = src.replace(
  'http://127.0.0.1:${port}/authorize`',
  '${(process.env.OFM_CALLBACK_SECURE ? "https" : "http")}://${(process.env.OFM_CALLBACK_HOST || "127.0.0.1")}:${(process.env.OFM_CALLBACK_PORT || port)}/authorize`'
);
src = src.replace(
  'http://127.0.0.1:${actualPort}/authorize`',
  '${(process.env.OFM_CALLBACK_SECURE ? "https" : "http")}://${(process.env.OFM_CALLBACK_HOST || "127.0.0.1")}:${(process.env.OFM_CALLBACK_PORT || actualPort)}/authorize`'
);

// ───────────────────────── 通用渠道（Loomy / LobsterAI / Raccoon / Carrier） ─────────────────────────
// 回调服务绑定地址: server.listen(<port>, "127.0.0.1" ...) -> OFM_LAN_IP
const bindRe = /(server\.listen\(\s*[0-9a-zA-Z_.]+\s*,\s*)"127\.0\.0\.1"/g;
const bindBefore = (src.match(bindRe) || []).length;
src = src.replace(bindRe, '$1(process.env.OFM_LAN_IP || "127.0.0.1")');

// 对外 URL: http://127.0.0.1:${port}/${actualPort}/${String(this.boundPort)}
//   -> OFM_CALLBACK_URL(完整) 或 (scheme://host:port)，scheme 受 OFM_CALLBACK_SECURE 控制
const urlRe = /http:\/\/127\.0\.0\.1:\$\{(port|actualPort|String\(this\.boundPort\))\}/g;
const urlBefore = (src.match(urlRe) || []).length;
src = src.replace(urlRe, (_m, expr) => {
  const inner = '(process.env.OFM_CALLBACK_SECURE ? "https" : "http") + "://" + (process.env.OFM_CALLBACK_HOST || process.env.OFM_LAN_IP || "127.0.0.1") + ":" + (process.env.OFM_CALLBACK_PORT || ' + expr + ')';
  return '${(process.env.OFM_CALLBACK_URL || (' + inner + '))}';
});

if (bindBefore === 0 && urlBefore === 0) {
  console.warn('[patch-lan-login] 警告: 未找到任何可补丁的 127.0.0.1 登录地址（上游可能已改）');
}

// ───────────────────────── 0.11 后端: login.submitCallback RPC ─────────────────────────
// 插在 login.poll case 之后。粘贴的 URL 自带端口（即待处理回调服务的 loopback 端口），
// 故无需在 account.create 侧记账；转发给 127.0.0.1:<port>/authorize 即完整复用上游链路。
const submitCallbackCase = `      case "login.submitCallback": {
        const req = payload;
        if (!req || req.provider !== TRAE.id) {
          return { ok: false, error: { code: "bad-request", message: "仅 TRAE 渠道支持手动投递回调地址" } };
        }
        const raw = typeof req.url === "string" ? req.url.trim() : "";
        if (raw.length === 0 || raw.length > 8192) {
          return { ok: false, error: { code: "bad-request", message: "回调地址为空或过长" } };
        }
        let parsedCallback;
        try {
          parsedCallback = new URL(raw);
        } catch {
          return { ok: false, error: { code: "bad-request", message: "回调地址无法解析——请复制授权后浏览器地址栏的完整 URL（含 ? 后全部参数）" } };
        }
        const loopbackHosts = ["127.0.0.1", "localhost", "[::1]"];
        if (parsedCallback.protocol !== "http:" || !loopbackHosts.includes(parsedCallback.hostname)) {
          return { ok: false, error: { code: "bad-request", message: "仅接受 http://127.0.0.1:<端口>/authorize 形态的回调地址（即授权后浏览器地址栏显示的地址）" } };
        }
        if (!parsedCallback.pathname.startsWith("/authorize")) {
          return { ok: false, error: { code: "bad-request", message: "回调地址路径必须是 /authorize" } };
        }
        const hasTokenParam = ["refreshToken", "userJwt", "code", "authCode", "authCodeInfo"].some((key) => (parsedCallback.searchParams.get(key) ?? "").trim().length > 0);
        if (!hasTokenParam) {
          return { ok: false, error: { code: "bad-request", message: "回调地址缺少令牌参数（refreshToken / userJwt）——请复制授权后地址栏的完整 URL，不要只复制到 ? 之前" } };
        }
        const callbackPort = Number(parsedCallback.port) || 80;
        try {
          const callbackResp = await fetch("http://127.0.0.1:" + callbackPort + parsedCallback.pathname + parsedCallback.search, { signal: AbortSignal.timeout(3e4) });
          const callbackText = await callbackResp.text().catch(() => "");
          if (callbackResp.ok) {
            return { ok: true, value: { submitted: true, message: callbackText.slice(0, 200) } };
          }
          return { ok: false, error: { code: "bad-request", message: callbackText.slice(0, 300) || "回调处理失败（HTTP " + callbackResp.status + "）" } };
        } catch (submitError) {
          const reason = submitError instanceof Error ? submitError.message : String(submitError);
          return { ok: false, error: { code: "bad-request", message: "回调服务不可达（登录可能已超时，请重新「添加账号」并再次授权）: " + reason } };
        }
      }
`;
const submitCallbackAnchor = '        return { ok: true, value: { done: true, success: true } };\n      }\n';
const submitAnchorCount = src.split(submitCallbackAnchor).length - 1;
if (submitAnchorCount !== 1) {
  console.error(`[patch-lan-login] 错误: login.poll 成功返回锚点匹配 ${submitAnchorCount} 处（期望 1），中止`);
  process.exit(1);
}
src = src.replace(submitCallbackAnchor, submitCallbackAnchor + submitCallbackCase);

src = marker + '\n' + src;
fs.writeFileSync(file, src);
console.log(`[patch-lan-login] 完成: 绑定地址 ${bindBefore} 处, 对外 URL ${urlBefore} 处 -> 改用 OFM_LAN_IP / OFM_CALLBACK_*; login.submitCallback 已注入`);

// ───────────────────────── 0.11 前端: 管理页「TRAE 登录助手」悬浮面板 ─────────────────────────
const webAppFile = '/app/packages/standalone/web/app.js';
const panelMarker = '/* OFM-TRAE-CALLBACK-PANEL */';
const panelCode = `;(function () {
  if (typeof window === "undefined" || window.__ofmTraeCbPanel) return;
  window.__ofmTraeCbPanel = true;
  function ready(fn) { if (document.readyState !== "loading") fn(); else document.addEventListener("DOMContentLoaded", fn); }
  ready(function () {
    var open = false, busy = false;
    var style = document.createElement("style");
    style.textContent = "#ofm-trae-cb{position:fixed;right:16px;bottom:16px;z-index:99999;font:13px/1.5 system-ui,-apple-system,'PingFang SC','Microsoft YaHei',sans-serif}"
      + "#ofm-trae-cb .tab{background:#2563eb;color:#fff;border-radius:8px;padding:8px 12px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.25);user-select:none}"
      + "#ofm-trae-cb .box{display:none;margin-top:8px;width:360px;background:#fff;color:#111;border:1px solid #d4d4d8;border-radius:10px;padding:12px;box-shadow:0 8px 24px rgba(0,0,0,.25)}"
      + "#ofm-trae-cb .box.open{display:block}"
      + "#ofm-trae-cb textarea{width:100%;height:88px;box-sizing:border-box;font:12px/1.4 ui-monospace,monospace;border:1px solid #d4d4d8;border-radius:6px;padding:6px;resize:vertical}"
      + "#ofm-trae-cb .row{display:flex;gap:8px;align-items:center;margin-top:8px}"
      + "#ofm-trae-cb button.go{background:#2563eb;color:#fff;border:0;border-radius:6px;padding:6px 14px;cursor:pointer}"
      + "#ofm-trae-cb button.go:disabled{opacity:.6;cursor:default}"
      + "#ofm-trae-cb .hint{color:#71717a}"
      + "#ofm-trae-cb .status{margin-top:6px;word-break:break-all}"
      + "#ofm-trae-cb .ok{color:#16a34a}#ofm-trae-cb .err{color:#dc2626}";
    document.head.appendChild(style);
    var root = document.createElement("div");
    root.id = "ofm-trae-cb";
    root.innerHTML = '<div class="tab">TRAE 登录助手</div><div class="box">'
      + '<div>在弹窗完成 TRAE 授权后，若浏览器停留在「登录失败」页，复制地址栏的<b>完整回调地址</b>（http://127.0.0.1:端口/authorize?...）粘贴到这里：</div>'
      + '<textarea placeholder="http://127.0.0.1:18080/authorize?isRedirect=true&amp;..."></textarea>'
      + '<div class="row"><button class="go">投递到服务器</button><span class="hint">服务器将完成令牌兑换并自动入账</span></div>'
      + '<div class="status"></div></div>';
    document.body.appendChild(root);
    var tab = root.querySelector(".tab"), box = root.querySelector(".box"), ta = root.querySelector("textarea"),
      go = root.querySelector(".go"), status = root.querySelector(".status");
    tab.addEventListener("click", function () { open = !open; box.className = open ? "box open" : "box"; });
    go.addEventListener("click", function () {
      if (busy) return;
      var url = (ta.value || "").trim();
      if (!url) { status.className = "status err"; status.textContent = "请先粘贴回调地址"; return; }
      busy = true; go.disabled = true; status.className = "status"; status.textContent = "投递中…";
      fetch("/api/management/channels/rpc", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ method: "login.submitCallback", payload: { provider: "trae", url: url } })
      }).then(function (r) { return r.json().catch(function () { return null; }); }).then(function (data) {
        if (data && data.ok) {
          status.className = "status ok";
          status.textContent = "✓ 已投递：服务器正在换取凭据并入账，几秒后刷新页面即可看到账号。" + (data.value && data.value.message ? "（" + data.value.message + "）" : "");
          ta.value = "";
        } else {
          status.className = "status err";
          status.textContent = (data && data.error && data.error.message) || "投递失败（请确认已在管理页登录）";
        }
      }).catch(function (e) {
        status.className = "status err"; status.textContent = "网络错误：" + e;
      }).finally(function () { busy = false; go.disabled = false; });
    });
  });
})();
`;
let webApp = fs.readFileSync(webAppFile, 'utf8');
if (webApp.includes(panelMarker)) {
  console.log('[patch-lan-login] 前端面板已存在，跳过');
} else {
  if (!webApp.endsWith('\n')) webApp += '\n';
  webApp += '\n' + panelMarker + '\n' + panelCode;
  fs.writeFileSync(webAppFile, webApp);
  console.log('[patch-lan-login] 前端面板已注入 web/app.js');
}

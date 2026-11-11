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

src = marker + '\n' + src;
fs.writeFileSync(file, src);
console.log(`[patch-lan-login] 完成: 绑定地址 ${bindBefore} 处, 对外 URL ${urlBefore} 处 -> 改用 OFM_LAN_IP / OFM_CALLBACK_*`);

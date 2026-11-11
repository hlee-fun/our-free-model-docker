// docker/patch-lan-login.mjs
// 修复 EAC router 下各类「添加账号」登录流程在局域网下把回调地址写死成
// http://127.0.0.1:<port> 的问题（Loomy 微信 / Trae / LobsterAI / Raccoon / Carrier 等）。
//
// 上游这些登录流会在本机起一个临时 OAuth 回调服务，并把
//   - 服务绑定地址写死 server.listen(<port>, "127.0.0.1")
//   - 对外展示/发给服务商的回调 URL 写死 http://127.0.0.1:<port>/...
// 局域网其他设备打开该链接时，127.0.0.1 指向的是设备自己，连不到宿主，登录无法进行。
//
// 补丁：把绑定地址与 URL 中的 127.0.0.1 改为运行时环境变量 OFM_LAN_IP。
//   - 未设置 OFM_LAN_IP 时 → 行为与上游完全一致（127.0.0.1），本机登录不受影响。
//   - 设置后（由 entrypoint 自动探测宿主局域网主 IP，或手动覆盖）→ 局域网设备可正常使用。
//
// 渠道差异（关键）：
//   - Loomy 微信 / LobsterAI / Raccoon / Carrier 等是「网页 / 服务端中继」回调，需要回调地址
//     对发起登录的设备可达，故把 127.0.0.1 改成 OFM_LAN_IP（或 OFM_CALLBACK_*）即可在多设备
//     / 跨网段下使用。
//   - TRAE 的 native_ide 登录：auth_callback_url 必须由 TRAE 桌面端 IDE 本机本地服务处理
//     （固定 127.0.0.1:18080），IDE 收不到非本地回调。故 TRAE 的回调地址【故意不改】，
//     保持上游原始的 127.0.0.1（见下方「TRAE 豁免」）。这是 Loomy 能改、TRAE 不能改的原因。
//
// 远程 / 跨网段访问（经 frp 或内网多子网）时的回调可达性（仅作用于非 TRAE 渠道）：
//   - OFM_CALLBACK_URL（可选，最高优先级）：回调 URL 的完整 base（含 scheme + host，
//     可选 :port），如 https://ofm.example.com。设了它则直接用作回调前缀，原端口不再追加。
//   - OFM_CALLBACK_HOST / OFM_CALLBACK_PORT（可选）：仅覆盖 host / 端口，scheme 固定
//     http://，适用于内网可达的同网段主机名 / IP。
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

// 1) 回调服务绑定地址: server.listen(<port>, "127.0.0.1" ...) -> OFM_LAN_IP
//    仅匹配 server.listen 调用，避免误伤其它 "127.0.0.1" 字符串。

// 1.1) 先保护 TRAE 的绑定（listenOrReject 内 `server.listen(port, "127.0.0.1", () =>`）：
//      TRAE native_ide 的回调是由 IDE 本机本地服务接收（固定 127.0.0.1:18080），
//      这个 server 必须继续绑定 127.0.0.1，不能改成 LAN IP。
//      用「带 () => 回调」来区分 TRAE 这处与 LobsterAI/Loomy/Raccoon（listen 0）+ Carrier
//      （listen(port) 但无回调）/ isPortFree 探针（listen(port) 但无回调）。
src = src.replace(
  /server\.listen\(port,\s*"127\.0\.0\.1",\s*\(\)\s*=>/g,
  'OFM_TRAE_BIND_PORT_HOLDER() =>'
);

const bindRe = /(server\.listen\(\s*[0-9a-zA-Z_.]+\s*,\s*)"127\.0\.0\.1"/g;
const bindBefore = (src.match(bindRe) || []).length;
src = src.replace(bindRe, '$1(process.env.OFM_LAN_IP || "127.0.0.1")');

// 1.5) TRAE 豁免：TRAE native_ide 的 auth_callback_url（auth_callback_url 参数）必须由 IDE
//      本机本地服务处理（固定 127.0.0.1:18080），IDE 收不到非本地回调。故 TRAE 的回调地址
//      【故意不改】，保持上游原始的 127.0.0.1（否则 trae.cn 授权页会直接拒绝非 loopback 回调，
//      表现为「弹出授权页→未操作就登录失败」）。这是 Loomy 等能改、TRAE 不能改的原因。
//      这里先把 TRAE 的两处 `const callbackUrl = .../authorize` 用占位符替换，最后再还原。
src = src.replace(/http:\/\/127\.0\.0\.1:\$\{(port)\}(\/authorize`)/g, 'OFM_TRAE_CB_PORT$2');
src = src.replace(/http:\/\/127\.0\.0\.1:\$\{(actualPort)\}(\/authorize`)/g, 'OFM_TRAE_CB_ACTUALPORT$2');

// 2) 对外 URL: http://127.0.0.1:${port} / ${actualPort} / ${String(this.boundPort)}
//    显式列出登录流用到的端口表达式，故意排除桌面端 Chrome DevTools 的 ${this.port}。
//    注意: 替换串里 process.env.OFM_LAN_IP 的 $ 必须转义(\$)，否则会被本脚本在构建期求值；
//    而 ${expr} 不转义，用于把捕获到的端口表达式(port/actualPort/String(...))原样写回。
const urlRe = /http:\/\/127\.0\.0\.1:\$\{(port|actualPort|String\(this\.boundPort\))\}/g;
const urlBefore = (src.match(urlRe) || []).length;
// 用普通字符串拼接写出字面 ${port}/${actualPort}/${String(this.boundPort)},
// 这样文件里保留的是模板占位符, 运行时才被正确求值。
src = src.replace(urlRe, (_m, expr) =>
  '${(process.env.OFM_CALLBACK_URL || ("http://" + (process.env.OFM_CALLBACK_HOST || process.env.OFM_LAN_IP || "127.0.0.1") + ":" + (process.env.OFM_CALLBACK_PORT || ' + expr + ')))}'
);

// 1.6) 还原 TRAE 豁免占位符为原始 127.0.0.1（不改 TRAE 绑定与回调地址）
src = src.replace(/OFM_TRAE_BIND_PORT_HOLDER\(\)\s*=>/g, 'server.listen(port, "127.0.0.1", () =>');
src = src.replace(/OFM_TRAE_CB_PORT(\/authorize`)/g, 'http://127.0.0.1:${port}$1');
src = src.replace(/OFM_TRAE_CB_ACTUALPORT(\/authorize`)/g, 'http://127.0.0.1:${actualPort}$1');

if (bindBefore === 0 && urlBefore === 0) {
  console.warn('[patch-lan-login] 警告: 未找到任何可补丁的 127.0.0.1 登录地址（上游可能已改）');
}

src = marker + '\n' + src;
fs.writeFileSync(file, src);
console.log(`[patch-lan-login] 完成: 绑定地址 ${bindBefore} 处, 对外 URL ${urlBefore} 处 -> 改用 OFM_LAN_IP`);

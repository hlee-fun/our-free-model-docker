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
const bindRe = /(server\.listen\(\s*[0-9a-zA-Z_.]+\s*,\s*)"127\.0\.0\.1"/g;
const bindBefore = (src.match(bindRe) || []).length;
src = src.replace(bindRe, '$1(process.env.OFM_LAN_IP || "127.0.0.1")');

// 2) 对外 URL: http://127.0.0.1:${port} / ${actualPort} / ${String(this.boundPort)}
//    显式列出登录流用到的端口表达式，故意排除桌面端 Chrome DevTools 的 ${this.port}。
//    注意: 替换串里 process.env.OFM_LAN_IP 的 $ 必须转义(\$)，否则会被本脚本在构建期求值；
//    而 ${expr} 不转义，用于把捕获到的端口表达式(port/actualPort/String(...))原样写回。
const urlRe = /http:\/\/127\.0\.0\.1:\$\{(port|actualPort|String\(this\.boundPort\))\}/g;
const urlBefore = (src.match(urlRe) || []).length;
// 用普通字符串拼接写出字面 ${port}/${actualPort}/${String(this.boundPort)},
// 这样文件里保留的是模板占位符, 运行时才被正确求值。
src = src.replace(urlRe, (_m, expr) => 'http://${process.env.OFM_LAN_IP || "127.0.0.1"}:${' + expr + '}');

if (bindBefore === 0 && urlBefore === 0) {
  console.warn('[patch-lan-login] 警告: 未找到任何可补丁的 127.0.0.1 登录地址（上游可能已改）');
}

src = marker + '\n' + src;
fs.writeFileSync(file, src);
console.log(`[patch-lan-login] 完成: 绑定地址 ${bindBefore} 处, 对外 URL ${urlBefore} 处 -> 改用 OFM_LAN_IP`);

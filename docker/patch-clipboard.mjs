// docker/patch-clipboard.mjs
// 修复管理页「API 接入」复制按钮在局域网 HTTP（non-secure context）下报错：
//   Cannot read properties of undefined (reading 'writeText')
//
// 根因: 上游构建产物 packages/standalone/web/app.js 中, API 接入页的复制 hook
//   直接调用 navigator.clipboard.writeText, 既无可选链判空、也无 try/catch 兜底。
//   浏览器仅在 secure context (HTTPS / http://localhost / http://127.0.0.1) 下
//   才暴露 navigator.clipboard; 经局域网 IP 的 http://<IP>:18900 访问时
//   navigator.clipboard 为 undefined, 对其读取 .writeText 即抛上述错误。
//
// 其他复制入口(client.js / 登录 UI / 赞助页)均已有判空 + execCommand 降级, 唯独此处遗漏。
//
// 补丁: 把该 copy 改为
//   1) 可选链判空 navigator?.clipboard?.writeText, 存在才用 Clipboard API;
//   2) 失败/不可用时降级到 document.execCommand('copy') 文本域选中方案(与 client.js legacy 一致);
//   3) 仍失败才提示手动复制。
// 不改任何上游源码, 仅替换构建产物中的这一处字符串; 带哨兵标记, 可重复执行(幂等)。

import fs from 'node:fs'

const target = '/app/packages/standalone/web/app.js'
const sentinel = 'OFM-CLIPBOARD-PATCH'

if (!fs.existsSync(target)) {
  console.error(`[patch-clipboard] 未找到 ${target}（镜像结构可能已变化）; 补丁中止`)
  process.exit(1)
}

let src = fs.readFileSync(target, 'utf8')

if (src.includes(sentinel)) {
  console.log('[patch-clipboard] 已打过补丁, 跳过')
  process.exit(0)
}

const buggy = 'copy:async V=>{await navigator.clipboard.writeText(V),z("已复制到剪贴板")}'
const count = src.split(buggy).length - 1
if (count === 0) {
  console.error('[patch-clipboard] 未找到缺陷代码片段（上游 app.js 可能已改动）; 补丁中止')
  process.exit(1)
}

const safe = `copy:async V=>{try{if(navigator?.clipboard?.writeText){await navigator.clipboard.writeText(V);z("已复制到剪贴板");return}}catch(_){}try{const t=document.createElement("textarea");t.value=V;t.style.position="fixed";t.style.top="0";t.style.left="0";t.style.opacity="0";document.body.appendChild(t);t.focus();t.select();const o=document.execCommand("copy");document.body.removeChild(t);if(o){z("已复制到剪贴板");return}}catch(_){}z("复制失败，请选中文本手动复制")}/* ${sentinel} */`

src = src.replaceAll(buggy, safe)
fs.writeFileSync(target, src)
console.log(`[patch-clipboard] 完成: 替换 ${count} 处 API 接入复制代码 -> 增加 navigator?.clipboard 判空 + execCommand 降级`)

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
//
// 2026-11-11 适配上游 2.8.3: app.js 重新压缩后, 缺陷片段里的变量名被 minifier 重命名
//   (V->N, z->S), 早期写死 V/z 的整串匹配会失效并中止构建。缺陷本身仍在(仍是裸
//   navigator.clipboard.writeText)。现改为按「结构」匹配, 捕获变量名与 toast 函数名后
//   原样写回, 不再依赖具体压缩变量名, 同时兼容新旧两版:
//     2.8.0: copy:async V=>{await navigator.clipboard.writeText(V),z("已复制到剪贴板")}
//     2.8.3: copy:async N=>{await navigator.clipboard.writeText(N),S("已复制到剪贴板")}

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

// 结构锚点: \1 保证 writeText 的参数与 copy 形参同名; 组 2 捕获 toast 函数。
// 不绑定压缩变量名, 因此上游再次重命名变量也不会失效。
const defectRe = /copy:async ([A-Za-z_$][\w$]*)=>\{await navigator\.clipboard\.writeText\(\1\),([A-Za-z_$][\w$]*)\("已复制到剪贴板"\)\}/g
const matches = [...src.matchAll(defectRe)]

if (matches.length === 0) {
  console.error('[patch-clipboard] 未找到缺陷代码片段（上游 app.js 结构可能已改动）; 补丁中止')
  console.error(`[patch-clipboard] 诊断: copy:async 出现 ${src.split('copy:async').length - 1} 次, `
    + `裸 navigator.clipboard.writeText 出现 ${src.split('navigator.clipboard.writeText').length - 1} 次, `
    + `"已复制到剪贴板" 出现 ${src.split('已复制到剪贴板').length - 1} 次`)
  console.error('[patch-clipboard] 若上游已自行修复该缺陷, 请人工确认后调整/移除本补丁, 不要静默跳过构建。')
  process.exit(1)
}

const safe = (v, toast) => `copy:async ${v}=>{try{if(navigator?.clipboard?.writeText){await navigator.clipboard.writeText(${v});${toast}("已复制到剪贴板");return}}catch(_){}try{const t=document.createElement("textarea");t.value=${v};t.style.position="fixed";t.style.top="0";t.style.left="0";t.style.opacity="0";document.body.appendChild(t);t.focus();t.select();const o=document.execCommand("copy");document.body.removeChild(t);if(o){${toast}("已复制到剪贴板");return}}catch(_){}${toast}("复制失败，请选中文本手动复制")}/* ${sentinel} */`

src = src.replace(defectRe, (_match, v, toast) => safe(v, toast))
fs.writeFileSync(target, src)
const names = [...new Set(matches.map(m => `${m[1]}/${m[2]}`))].join(', ')
console.log(`[patch-clipboard] 完成: 替换 ${matches.length} 处 API 接入复制代码 (形参/toast: ${names}) -> 增加 navigator?.clipboard 判空 + execCommand 降级`)

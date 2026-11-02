/**
 * 容器化补丁: 让管理页 /api/management/summary 按「请求实际 Host 头」自动回写 baseUrl。
 *
 * 背景: 上游 service.mjs 的 info() 把 baseUrl 写死为 http://127.0.0.1:<port>
 *   (见 service.mjs 的 `baseUrl: \`http://${host}:${port}\`` , host 恒为 '127.0.0.1')。
 *   局域网设备经 socat 透传用宿主 IP(如 10.8.8.199:18900)访问时, 浏览器从 summary
 *   拿到的 baseUrl 仍是 127.0.0.1, 于是前端用它拼接 /v1、做登录后跳转, 全部指向来访者
 *   自己的本机回环, 表现为「API 接入 / 跳转仍为 127.0.0.1、页面无法显示」。
 *
 * 做法: 在返回 summary 时, 若请求带 Host 头(HTTP/1.1 必然带), 用其覆盖 baseUrl。
 *   - Host 头由 socat 原样透传, 局域网下即为来访者输入的宿主 IP:端口, 即「自动获取, 非固定值」;
 *   - 同机 127.0.0.1 访问时 Host 就是 127.0.0.1, 行为与上游一致;
 *   - 不影响监听绑定(app 仍只绑 loopback, 由 socat 负责透传);
 *   - 未带 Host 时回退上游原值, 不引入副作用。
 * MIT 允许修改; 构建期自动应用, 上游升级只需重新提取文件即可(脚本会校验结构是否变化)。
 */
import fs from 'node:fs'

const target = '/app/packages/standalone/management.mjs'
const source = fs.readFileSync(target, 'utf8')

const anchor = 'json(res, 200, summary())'
const marker = 'OFM_BASE_URL_FROM_HOST'

if (!source.includes(anchor)) {
  console.error('[patch-baseurl] 未找到 summary 返回点, management.mjs 结构可能已变化; 补丁中止')
  process.exit(1)
}
if (source.includes(marker)) {
  console.log('[patch-baseurl] 已打过补丁, 跳过')
  process.exit(0)
}

const replacement = `json(res, 200, (() => {
  const __s = summary()
  const __host = req.headers.host
  if (__host) __s.baseUrl = \`\${req.socket.encrypted ? 'https' : 'http'}://\${__host}\`
  return __s
})()) /* ${marker} */`

const patched = source.replace(anchor, replacement)
fs.writeFileSync(target, patched)
console.log('[patch-baseurl] 已完成: summary 按请求 Host 自动回写 baseUrl (修复局域网 127.0.0.1)')

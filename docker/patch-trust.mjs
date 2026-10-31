/**
 * 极小补丁: 给上游 trust.js 的 Host 信任围栏加一个环境变量开关 OFM_TRUSTED_HOSTS。
 *
 * 背景: 上游 src/trust.js 的 structuralReason() 要求管理请求的 Host 必须是 loopback 名
 *   (127.0.0.1 / ::1 / localhost), 且 Origin/Referer 必须与 Host 一致 —— 即 "Host 信任围栏"
 *   (issue #216)。因此即使把管理端口透传到局域网, 局域网设备用 <宿主IP> 访问也会被 403。
 *
 * 做法: 在保留 loopback 的前提下, 允许 OFM_TRUSTED_HOSTS (逗号分隔的主机名/IP) 通过围栏。
 *   - 只改围栏判定, 不改监听绑定(监听仍由 socat 透传, app 自身仍绑 loopback);
 *   - 未设置 OFM_TRUSTED_HOSTS 时, 行为与上游完全一致(默认仍只信任 loopback);
 *   - MIT 允许修改; 构建期自动应用, 上游升级只需重新提取文件即可(脚本会校验结构是否变化)。
 */
import fs from 'node:fs'

const target = '/app/src/trust.js'
const source = fs.readFileSync(target, 'utf8')

const defLine = "const LOOPBACK_NAMES = new Set(['127.0.0.1', '[::1]', '::1', 'localhost'])"
const fenceLine = '!LOOPBACK_NAMES.has(host.hostname)'

if (!source.includes(defLine)) {
  console.error('[patch-trust] 未找到 LOOPBACK_NAMES 定义, trust.js 结构可能已变化; 补丁中止')
  process.exit(1)
}
if (!source.includes(fenceLine)) {
  console.error('[patch-trust] 未找到围栏判定行, trust.js 结构可能已变化; 补丁中止')
  process.exit(1)
}
if (source.includes('TRUSTED_HOST_NAMES')) {
  console.log('[patch-trust] 已打过补丁, 跳过')
  process.exit(0)
}

const patchedDefinition = `${defLine}

/** Docker 容器化补丁: 额外信任 OFM_TRUSTED_HOSTS 指定的主机名/IP(局域网访问管理页用)。
 *  未设置该环境变量时集合与 LOOPBACK_NAMES 等价, 行为与上游一致。 */
const TRUSTED_HOST_NAMES = new Set([
  ...LOOPBACK_NAMES,
  ...String(process.env.OFM_TRUSTED_HOSTS ?? '')
    .split(',')
    .map(value => value.trim().toLowerCase())
    .filter(Boolean),
])`

let patched = source.replace(defLine, patchedDefinition)
patched = patched.replace(fenceLine, '!TRUSTED_HOST_NAMES.has(host.hostname)')

fs.writeFileSync(target, patched)
console.log('[patch-trust] 已完成: trust.js 围栏支持 OFM_TRUSTED_HOSTS (默认仍仅 loopback)')

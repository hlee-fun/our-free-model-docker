#!/usr/bin/env node
// =============================================================================
// 补丁入口（不修改上游源码）
// -----------------------------------------------------------------------------
// 问题：EAC router「测试模型」对 worker 渠道模型（loomy / qoder / trae / cline /
//       lobsterai / raccoon / minimax / zcode / gemini 等）误报
//       "Unknown model "..."（HTTP 404）。
//
// 根因：management 的 POST /api/management/models/test 走 runtime.testModel，
//       而 service.mjs 里的 runtime 包装对象只重写了 catalog / state /
//       publicModelRows / complete / refreshCatalog，**没有重写 testModel**，
//       于是落到 core.testModel —— 它只查 core.catalog（free + sealed/EAC 网关），
//       不含 channels.publicModelRows() 里的 worker 模型。summary 能列出这些
//       模型（runtime.catalog 合并了 channels），但测试时 core.testModel 在
//       core.catalog 里找不到 → 抛 Unknown。
//
// 修复：在 startStandalone 返回后重写 runtime.testModel：
//       - 若 channels.handles(model)（worker 渠道模型），先校验模型存在，
//         再走 channels.complete 做一次真实小测；
//       - 否则退回原始 core.testModel（free / sealed / kilo 等不受影响）。
//
// 本文件不 import 任何私有符号、不改动 service.mjs / core.js / management.mjs /
// cli.mjs，仅运行时给返回的 runtime 对象补一个方法，符合「不改源码、打补丁」。
// =============================================================================
import path from 'node:path'
import { startStandalone } from './packages/standalone/service.mjs'

const usage = `Our Free Model 独立本地服务（已打 testModel 补丁）
用法：node start-patched.mjs [选项]   （参数同 cli.mjs）

  --port <端口>       监听端口，默认 18900（冲突时自动选择可用端口）
  --data-dir <目录>   数据目录，默认 OFM_HOME 或 ~/.our-free-model
  --no-refresh        跳过启动与周期刷新；仍可手动刷新和推理
  --probe             已停用（保留兼容）：自动探测不会发送任何请求
  --lan               启用并保存 LAN 推理中继（独立密钥，管理页仍仅限本机）
  --no-lan            关闭并保存 LAN 推理中继
  --lan-port <端口>   保存 LAN 期望端口，默认 0；不会单独开启中继
  --help              显示帮助
`

async function main() {
  const options = {}
  for (let index = 2; index < process.argv.length; index++) {
    const flag = process.argv[index]
    if (flag === '--help') { process.stdout.write(usage); return }
    if (flag === '--no-refresh') { options.refresh = false; continue }
    if (flag === '--probe') { options.probe = true; continue }
    if (flag === '--lan' || flag === '--no-lan') { options.lanEnabled = flag === '--lan'; continue }
    if (!['--port', '--data-dir', '--lan-port'].includes(flag) || !process.argv[index + 1] || process.argv[index + 1].startsWith('--')) {
      throw new Error(`未知选项或缺少参数：${flag}`)
    }
    const value = process.argv[++index]
    if (flag === '--port' || flag === '--lan-port') {
      if (!/^\d+$/.test(value) || Number(value) > 65535) throw new Error('端口必须为 0 到 65535 的整数')
      options[flag === '--port' ? 'port' : 'lanPort'] = Number(value)
    } else options.dataDir = path.resolve(value)
  }

  const service = await startStandalone(options)

  // ===== 补丁：重写 runtime.testModel，让 worker 渠道模型正确测试 =====
  const originalTest = service.runtime.testModel
  const channels = service.channels
  service.runtime.testModel = async function patchedTestModel(id, effort, opts = {}) {
    // 仅 worker 渠道模型走此分支；其余（free / sealed / kilo）退回原始实现。
    if (channels.handles(id)) {
      const rows = channels.publicModelRows()
      const entry = rows.find(r => r.id === id)
      if (!entry) {
        const err = new Error(`Unknown model "${id}"`)
        err.status = 404
        throw err
      }
      const started = Date.now()
      try {
        const outcome = await channels.complete({
          model: id,
          messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
          signal: opts?.signal,
        })
        if (outcome?.error) {
          const e = new Error(typeof outcome.error === 'string' ? outcome.error : (outcome.error.message ?? '模型测试失败'))
          e.status = outcome.error.status ?? 502
          throw e
        }
        return { model: id, ok: true, ttftMs: outcome.firstTokenMs ?? undefined, latencyMs: Date.now() - started }
      } catch (error) {
        const e = new Error(error?.message ?? '模型测试失败')
        e.status = error?.statusCode ?? error?.status ?? 502
        throw e
      }
    }
    return originalTest(id, effort, opts)
  }
  service.runtime.__patched_testModel = true
  process.stdout.write('[patch] runtime.testModel 已补丁：worker 渠道模型测试将走 channels.complete\n')

  // ===== 进程生命周期（同 cli.mjs）=====
  let stopping = false
  const shutdown = () => {
    if (stopping) return
    stopping = true
    void service.close().catch(error => {
      process.stderr.write(`停止失败：${error.message}\n`)
      process.exitCode = 1
    })
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
  process.stdout.write(`${service.product} ${service.version}\n管理页面（10 分钟内一次性登录）：${service.managementUrl}\nAPI：${service.url}/v1\nAPI Key 保存在：${service.keyFile}\n`)
  if (service.lan.running) {
    process.stdout.write(`LAN API：${service.lan.baseUrls.join(', ') || `端口 ${service.lan.port}`}\nLAN Key：请在本机管理接口中查看（独立于本机 API Key）\n`)
  } else if (service.lan.error) process.stderr.write(`${service.lan.error}\n`)
}

main().catch(error => {
  process.stderr.write(`启动失败：${error.code === 'EEXIST' ? '数据目录已有服务运行，或 service.lock 的归属无法确认；请先退出已有服务。Windows 和 Linux 会自动回收已确认进程退出的陈旧锁。' : error.message}\n`)
  process.exitCode = 1
})

/**
 * 渲染冒烟测试：把 src/ssr-entry.ts 用 vite SSR 构建成 node 能跑的文件，
 * 再跑一遍每个页面的 SSR 渲染，验证模板没有运行时错误。
 *
 * 用法：node tools/check-render.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import cp from 'node:child_process'

// 沙箱里禁止以 piped stdio 拉起子进程，vite 启动时的 exec("net use") 会抛 spawn EPERM。
// 必须在 import vite 之前把 exec/execFile 替换掉（见 tools/dev.cjs 的说明）。
const noopChild = () => ({
  on() { return this },
  once() { return this },
  kill() { return true },
  unref() { return this },
})
for (const name of ['exec', 'execFile']) {
  const original = cp[name]
  cp[name] = function patched(command, options, callback) {
    const cb = typeof options === 'function' ? options : callback
    if (typeof cb === 'function') {
      process.nextTick(() => cb(null, '', ''))
      return noopChild()
    }
    return original.call(cp, command, options, callback)
  }
}

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const clientDir = path.join(root, 'packages', 'client')
const outFile = path.join(root, '.tmp-ssr', 'ssr-entry.mjs')

fs.rmSync(path.dirname(outFile), { recursive: true, force: true })
fs.mkdirSync(path.dirname(outFile), { recursive: true })

const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'vite', 'dist', 'node', 'index.js')).href)

await build({
  root: clientDir,
  logLevel: 'warn',
  configFile: path.join(clientDir, 'vite.config.ts'),
  build: {
    ssr: path.join(clientDir, 'tests', 'ssr-entry.ts'),
    outDir: path.dirname(outFile),
    emptyOutDir: true,
    rollupOptions: { output: { entryFileNames: 'ssr-entry.mjs' } },
    minify: false,
    sourcemap: false,
  },
})

if (!fs.existsSync(outFile)) {
  console.error('SSR 构建没产出文件:', outFile)
  process.exit(1)
}

const { run } = await import(pathToFileURL(outFile).href)
const { results, failures } = await run()

for (const r of results) {
  console.log(`  ✓ ${String(r.label).padEnd(12)} ${String(r.bytes).padStart(6)} 字节  ${r.head}`)
}

if (failures.length) {
  console.error(`\n渲染失败 ${failures.length} 项:`)
  for (const f of failures) console.error('  ✗ ' + f)
  fs.rmSync(path.dirname(outFile), { recursive: true, force: true })
  process.exit(1)
}

console.log(`\n全部 ${results.length} 个页面 SSR 渲染通过`)
fs.rmSync(path.dirname(outFile), { recursive: true, force: true })

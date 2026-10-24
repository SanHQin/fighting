// 沙箱内启动 vite 的垫片（正常终端不需要，直接 pnpm dev 即可）。
//
// 起因：vite 8 在 Windows 上启动时会调用 `exec("net use")`，用来判断有没有网络盘映射。
// DSH 的 workspace-write 沙箱禁止以 piped stdio 拉起子进程，`exec` 抛 `spawn EPERM`，
// 结果 `failed to load config from vite.config.ts`，dev server 起不来。
//
// 关键点：必须用 CJS 的 require 打补丁。若在 ESM 里 `import cp from 'node:child_process'`，
// 拿到的是导入时快照，之后改 cp.exec 对已经绑定过的命名导出无效。
//
// 用法：node ../tools/dev.cjs --port 5173 --host 127.0.0.1
// （在 packages/client 目录下运行；否则用 --root 指定根目录）

const path = require('node:path')
const { pathToFileURL } = require('node:url')
const cp = require('node:child_process')

const noopChild = () => ({
  on() { return this },
  once() { return this },
  kill() { return true },
  unref() { return this },
})

const patch = (name) => {
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

patch('exec')
patch('execFile')

// vite 的 bin 不在 package exports 里，因此直接按文件路径加载
const viteBin = path.join(process.cwd(), 'node_modules', 'vite', 'bin', 'vite.js')
const target = require('node:fs').existsSync(viteBin)
  ? viteBin
  : path.join(__dirname, '..', 'node_modules', 'vite', 'bin', 'vite.js')

import(pathToFileURL(target).href).catch((err) => {
  console.error(err)
  process.exit(1)
})

/**
 * 无头测试用的「把 TS 源码搬到 Node 里跑」工具箱。
 *
 * 为什么不用 tsx / ts-node：这个环境里 Node 拉起子进程走管道 stdio 会被沙箱拒，
 * 而 tsx 依赖 esbuild 的子进程。`ts.transpileModule` 是纯进程内 API，稳。
 *
 * 为什么统一放在这里：`battle-core` 是 TS 源码包（没有 dist），
 * 任何要在 Node 里跑模拟的脚本都得做同一套"转译 + 改写 specifier"的活。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

const here = path.dirname(fileURLToPath(import.meta.url))
export const root = path.resolve(here, '..', '..')
const coreDir = path.join(root, 'packages', 'battle-core', 'src')
const clientSrc = path.join(root, 'packages', 'client', 'src')

/**
 * 把 `packages/battle-core/src` 与 `packages/client/src/mock`、`types` 转译到临时目录。
 *
 * `tag` 用来区分不同脚本（并行跑时临时目录不能撞）。
 */
export async function loadSim(tag) {
  const outDir = path.join(root, `.tmp-${tag}`)
  fs.rmSync(outDir, { recursive: true, force: true })
  fs.mkdirSync(outDir, { recursive: true })

  const rewrite = (js) =>
    js
      .replace(/from ['"]@\/mock\/data['"]/g, "from './mock-data.mjs'")
      .replace(/from ['"]@\/types['"]/g, "from './types.mjs'")
      // battle-core 内部一律带 `.ts` 后缀（Node 原生跑 TS 的要求），转译后是 .mjs
      .replace(/from ['"]\.\/([A-Za-z0-9_-]+)\.ts['"]/g, "from './$1.mjs'")

  const transpile = (abs, outName) => {
    const js = ts.transpileModule(fs.readFileSync(abs, 'utf8'), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        verbatimModuleSyntax: false,
      },
      fileName: abs,
    }).outputText
    fs.writeFileSync(path.join(outDir, outName), rewrite(js), 'utf8')
  }

  // battle-core：文件名本身就是扁平命名，转译后同名
  for (const f of fs.readdirSync(coreDir)) {
    if (!f.endsWith('.ts')) continue
    transpile(path.join(coreDir, f), f.replace(/\.ts$/, '.mjs'))
  }
  transpile(path.join(clientSrc, 'types', 'index.ts'), 'types.mjs')
  transpile(path.join(clientSrc, 'mock', 'data.ts'), 'mock-data.mjs')

  const load = (name) => import(pathToFileURL(path.join(outDir, name)).href)

  const core = await load('index.mjs')
  const data = await load('mock-data.mjs')

  const charById = new Map(data.CHARS.map((c) => [c.id, c]))
  const stageById = new Map(data.STAGES.map((s) => [s.id, s]))

  /**
   * 按 id 建一局。内核的 `createWorld` 只要已解析的定义，
   * 查表在这儿做——这正是 loader 层的职责，测试脚本也该走同一条路。
   */
  const makeWorld = (aId, bId, stageId) => {
    const a = charById.get(aId)
    const b = charById.get(bId)
    const s = stageById.get(stageId)
    if (!a || !b || !s) throw new Error(`未知内容：${aId} / ${bId} / ${stageId}`)
    return core.createWorld(a, b, s)
  }

  return { core, data, outDir, makeWorld, charById, stageById, cleanup: () => fs.rmSync(outDir, { recursive: true, force: true }) }
}

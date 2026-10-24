/**
 * 图片缓存：道具/特效贴图按需加载，加载完成前先用几何图形顶上。
 *
 * 关键约束：**绝不能在 `draw()` 里同步创建 Image 并等它加载**。第一次画是同步的、
 * 图片一定还没好，于是要么这帧空白（闪烁）要么卡住主线程。这里只在第一次
 * `sprite()` 调用时发起加载，返回 null 表示"还没好"，调用方照旧画几何图形。
 *
 * 为什么不预加载：道具图按角色分目录，大厅页面不该为了进战斗去下别人的瓶子。
 */
type Entry = {
  img: HTMLImageElement | null
  ready: boolean
  failed: boolean
}

const CACHE = new Map<string, Entry>()

/**
 * 取一张已就绪的贴图；未就绪返回 null 并开始在后台加载。
 * @param url 以 `/` 开头的 public 路径
 */
export function sprite(url: string): HTMLImageElement | null {
  if (typeof window === 'undefined') return null

  let e = CACHE.get(url)
  if (!e) {
    const img = new Image()
    const entry: Entry = { img, ready: false, failed: false }
    CACHE.set(url, entry)
    img.decoding = 'async'
    img.onload = () => {
      entry.ready = true
    }
    img.onerror = () => {
      entry.failed = true
      // 失败后永久返回 null，让调用方稳定地走几何图形分支，
      // 而不是每次 draw 都重试一次 404
    }
    img.src = url
    e = entry
  }

  return e.ready && !e.failed ? e.img : null
}

/** 提前把下一场要用的图拉起来（选人页确认时调一次） */
export function warm(uris: readonly string[]): void {
  for (const u of uris) sprite(u)
}

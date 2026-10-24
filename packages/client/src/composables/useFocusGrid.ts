import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

/**
 * 二维焦点网格寻路，见 docs/04-ui-art.md 第 4 章「焦点环自维护」。
 *
 * 三个必须遵守的点：
 * 1. 不用 DOM :focus —— 手柄/键盘和 DOM 顺序不一致，选人页 2×2 网格按右到底格要停住。
 * 2. 找的是「同方向里分数最低的」，不是「数组里下一个」。
 *      score = 主轴上投影距离 * 1 + 垂直偏移 * 3（垂直代价更高，避免斜跳）
 * 3. 找不到就停在原地，绝不循环。
 */

export interface FocusItem {
  /** 唯一标识，DOM 上会映射成 data-focus-id */
  id: string
  /** 网格坐标，单位是「格」，不是像素 */
  x: number
  y: number
  /** 是否可聚焦，锁住的角色要跳过 */
  enabled?: boolean
  onConfirm?: () => void
  onCancel?: () => void
}

export type Direction = 'up' | 'down' | 'left' | 'right'

export interface FocusGridOptions {
  /** 初始焦点 id，不传取第一个 enabled 的 */
  initial?: string
  /** 按了方向但没找到邻居时的回调，用于播放「顶到边」的音效 */
  onEdge?: (dir: Direction) => void
}

export function useFocusGrid(items: Ref<FocusItem[]>, opts: FocusGridOptions = {}) {
  const focusedId = ref<string>(opts.initial ?? '')

  function firstEnabled(): FocusItem | undefined {
    return items.value.find((i) => i.enabled !== false)
  }

  if (!focusedId.value) {
    const f = firstEnabled()
    if (f) focusedId.value = f.id
  }

  function current(): FocusItem | undefined {
    return items.value.find((i) => i.id === focusedId.value)
  }

  function score(from: FocusItem, to: FocusItem, dir: Direction): number | null {
    const dx = to.x - from.x
    const dy = to.y - from.y
    // 主轴必须真的朝那个方向
    const main = dir === 'left' ? -dx : dir === 'right' ? dx : dir === 'up' ? -dy : dy
    if (main <= 0) return null
    const perp = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx)
    return main + perp * 3
  }

  function move(dir: Direction): boolean {
    const from = current()
    if (!from) return false
    let best: FocusItem | null = null
    let bestScore = Infinity
    for (const it of items.value) {
      if (it.id === from.id || it.enabled === false) continue
      const s = score(from, it, dir)
      if (s !== null && s < bestScore) {
        bestScore = s
        best = it
      }
    }
    if (!best) {
      opts.onEdge?.(dir)
      return false
    }
    focusedId.value = best.id
    return true
  }

  function confirm(): boolean {
    const c = current()
    if (!c || c.enabled === false) return false
    c.onConfirm?.()
    return true
  }

  function cancel(): boolean {
    const c = current()
    if (!c) return false
    if (!c.onCancel) return false
    c.onCancel()
    return true
  }

  function setFocus(id: string) {
    const it = items.value.find((i) => i.id === id)
    if (it && it.enabled !== false) focusedId.value = id
  }

  // ---- 输入映射 ----
  const KEYS: Record<string, Direction> = {
    ArrowUp: 'up',
    ArrowDown: 'down',
    ArrowLeft: 'left',
    ArrowRight: 'right',
    KeyW: 'up',
    KeyS: 'down',
    KeyA: 'left',
    KeyD: 'right',
  }

  function onKeyDown(e: KeyboardEvent) {
    // 输入框里不接管，否则打不出字
    const t = e.target as HTMLElement | null
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return

    const dir = KEYS[e.code]
    if (dir) {
      if (move(dir)) e.preventDefault()
      else e.preventDefault() // 顶到边也吞掉，防止页面滚动
      return
    }
    if (e.code === 'Enter' || e.code === 'Space' || e.code === 'NumpadEnter') {
      if (confirm()) e.preventDefault()
      return
    }
    if (e.code === 'Escape' || e.code === 'Backspace') {
      // ESC 的语义归属由调用方决定；这里只在明确给了 onCancel 时吞掉
      if (cancel()) e.preventDefault()
    }
  }

  onMounted(() => window.addEventListener('keydown', onKeyDown))
  onBeforeUnmount(() => window.removeEventListener('keydown', onKeyDown))

  return { focusedId, move, confirm, cancel, setFocus, current }
}

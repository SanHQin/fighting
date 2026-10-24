/**
 * 视口缩放：把 1280×720 的逻辑坐标映射到实际窗口，letterbox 不变形。
 * 见 docs/04-ui-art.md 第 2 章。
 *
 * 为什么必须锁 1280×720：所有物理常数的可读性（GRAVITY=0.85 每帧加多少像素）
 * 建立在「1 逻辑单位 = 720p 下 1 像素」上。改视口不改逻辑坐标，只改 CSS 缩放。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'

export interface ViewportMetrics {
  /** CSS 像素下的缩放比 */
  scale: number
  /** 实际渲染分辨率倍率，供 Pixi 用 */
  resolution: number
  /** letterbox 左右黑边 */
  offsetX: number
  /** letterbox 上下黑边 */
  offsetY: number
  vw: number
  vh: number
}

export function computeViewport(vw: number, vh: number, dpr: number): ViewportMetrics {
  const scale = Math.min(vw / 1280, vh / 720)
  return {
    scale,
    // 上限 2.5：再高只会拖累填充率，肉眼无收益
    resolution: Math.min(dpr * scale, 2.5),
    offsetX: (vw - 1280 * scale) / 2,
    offsetY: (vh - 720 * scale) / 2,
    vw,
    vh,
  }
}

export function useViewport() {
  const metrics = ref<ViewportMetrics>(computeViewport(1280, 720, 1))

  function update() {
    metrics.value = computeViewport(
      window.innerWidth,
      window.innerHeight,
      window.devicePixelRatio || 1,
    )
  }

  onMounted(() => {
    update()
    window.addEventListener('resize', update)
  })
  onBeforeUnmount(() => window.removeEventListener('resize', update))

  return { metrics, update }
}

/**
 * 相机（镜头）
 *
 * 为什么单独成一个模块，而不是留在 BattleView 里：
 * 镜头的正确性可以**脱离画面断言** —— 场地是否始终完整可见、视口有没有越出边界、
 * 帧率变了行为会不会跟着变。这些都能用数字验证，只要它是个纯函数。
 *
 * ── 取景模型 ──────────────────────────────────────────────
 *
 * 世界横向排布是：
 *
 *   blast 边缘 │   空白   │   战斗场地   │   空白   │ blast 边缘
 *
 * 两条硬约束（都是"必须"，不是"尽量"）：
 *   ① 战斗场地（全部平台的并集）**始终完整可见** —— 场地都看不全就谈不上判断站位；
 *   ② 视口**不许越出 blast 边界** —— 越出去只能看到虚空，玩家会以为自己卡了。
 *
 * 这两条联立直接给出缩放范围，不需要试：
 *
 *   场地完整可见  ⟹  V ≥ 场地宽  ⟹  zoom ≤ viewW / 场地宽
 *   视口在边界内  ⟹  V ≤ 边界宽  ⟹  zoom ≥ viewW / 边界宽
 *
 * 所以 `zoom ∈ [max(viewW/blastW, viewH/blastH), min(viewW/stageW, viewH/stageH)]`，
 * 两端都带安全留白。这个区间之外的状态在物理上就是矛盾的，不需要容错。
 *
 * 镜头中心的可动区间同理，是两个区间的**交集**：
 *   场地完整可见  ⟹  cam.x ∈ [场地右 - halfW, 场地左 + halfW]
 *   视口在边界内  ⟹  cam.x ∈ [边界左 + halfW, 边界右 - halfW]
 *
 * 这正好就是用户说的"镜头需要在空白与边界中间"—— 它不是一条规则，
 * 是上面两条约束的几何结果。
 *
 * 空白占比：
 *   两人都在场地上  → 取景框收缩到「场地 + 最小留白」，空白最少；
 *   有人走出去     → 取景框吃掉那个人的位置，放大率下降，空白变多；
 *   白到装不下     → 交给角标与箭头（`offscreenOf`），而不是继续缩小到看不见人。
 */

/** 矩形（世界坐标，y 向下为正） */
export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/**
 * 参与取景的角色，只要这几个字段。
 * 刻意不接收整个 Fighter —— 相机不该能读伤害、命数这些它用不到的东西。
 */
export interface CamFighter {
  x: number
  y: number
  vx: number
  vy: number
  crouching: boolean
  respawnTimer: number
}

/** 场地里参与"战斗场地"并集的平台 */
export interface CamPlatform {
  x: number
  y: number
  w: number
  h: number
}

/** 参与取景的世界，只要场地边界、平台与角色 */
export interface CamWorld {
  fighters: CamFighter[]
  stage: {
    blastZone: Box
    /** 平台定义（取静态定义而不是运行时状态：可破坏平台碎掉时镜头不该跟着跳） */
    platforms?: CamPlatform[] | undefined
  }
}

export interface CamState {
  x: number
  y: number
  zoom: number
  /** 经死区过滤后的目标缩放（不是每帧的 wantZoom） */
  zoomTarget: number
  /** 屏幕震动（纯表现层） */
  shake: number
  shakePhase: number
  init: boolean
  /**
   * 平滑后的取景框（世界坐标 minX/maxX/minY/maxY）。
   *
   * 为什么不直接用当帧的角色位置反推缩放：角色一帧能被击飞几十像素，
   * 拿当帧盒子算缩放，画面就会跟着每一次命中"抽"一下再弹回来。
   * 对盒子做一次低通，缩放只跟得上"趋势"，跟不上"抖动"。
   */
  bx0: number
  bx1: number
  by0: number
  by1: number
  boxInit: boolean
  /** 推近迟滞：连续满足多少帧才允许推近 */
  zoomHold: number
}

export interface CamTuning {
  /** 死区（屏幕像素）：目标在死区内就不追，避免微小移动让画面抖 */
  deadX: number
  deadY: number
  /** 最小留白（屏幕像素）：取景框贴着场地边缘时两侧各留多少 */
  padStageX: number
  padStageY: number
  /** 取景角色时的留白（屏幕像素）：比 padStage 大，人贴着边不好看 */
  padFighterX: number
  padFighterY: number
  /** 目标缩放变化小于这个值就不改，抑制"呼哧呼哧"的缩放泵 */
  zoomDeadband: number
  /** 拉远系数 / 推近系数：拉远慢了会有人出画，推近快了会晕 */
  zoomOutK: number
  zoomInK: number
  /** 取景框低通系数（每 60Hz 帧），越小越"稳"也越"迟钝" */
  boxK: number
  /** 推近迟滞：目标缩放比当前大这么多才算"该推近了" */
  zoomInThreshold: number
  /** 推近迟滞：连续满足多少帧才真的推近（防止来回蹭） */
  zoomInHold: number
  /** 留白从 padStage 过渡到 padFighter 的距离（世界像素） */
  padBlendRange: number
  /** 前视：按两人平均速度提前多少秒 */
  leadTime: number
  leadMaxX: number
  leadMaxY: number
  /** 平移基准系数与"距离越远追越快"的斜率 */
  panBase: number
  panSlope: number
  panMax: number
  /** 震屏每 60Hz 帧的衰减系数 */
  shakeDecay: number
  /** 角色身高（与 battle-core 的 C 保持一致，check-camera 会断言） */
  standH: number
  crouchH: number
  /** 角色头顶上方留多少（发饰/举起的武器） */
  headroom: number
  /** 屏幕逻辑尺寸 */
  viewW: number
  viewH: number
}

export const CAM_DEFAULTS: CamTuning = {
  deadX: 44,
  deadY: 32,
  padStageX: 40,
  padStageY: 34,
  padFighterX: 96,
  padFighterY: 86,
  zoomDeadband: 0.03,
  zoomOutK: 0.34,
  zoomInK: 0.1,
  boxK: 0.16,
  zoomInThreshold: 0.08,
  zoomInHold: 26,
  padBlendRange: 240,
  leadTime: 0.18,
  leadMaxX: 110,
  leadMaxY: 64,
  panBase: 0.09,
  panSlope: 0.34,
  panMax: 0.43,
  shakeDecay: 0.86,
  standH: 64,
  crouchH: 40,
  headroom: 28,
  viewW: 1280,
  viewH: 720,
}

export function createCam(y = -80): CamState {
  return {
    x: 0,
    y,
    zoom: 0.8,
    zoomTarget: 0.8,
    shake: 0,
    shakePhase: 0,
    init: false,
    bx0: 0,
    bx1: 0,
    by0: 0,
    by1: 0,
    boxInit: false,
    zoomHold: 0,
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/** 战斗场地：全部平台的并集。没有平台时退化成出生点附近的一小块。 */
export function stageBoxOf(w: CamWorld): Box {
  const ps = w.stage.platforms
  if (!ps || ps.length === 0) {
    // 没有平台定义时用边界内缩一圈兜底，保证取景框不会塌成 0
    const b = w.stage.blastZone
    return { x: b.x + b.w * 0.25, y: b.y + b.h * 0.25, w: b.w * 0.5, h: b.h * 0.5 }
  }
  let x0 = Infinity
  let x1 = -Infinity
  let y0 = Infinity
  let y1 = -Infinity
  for (const p of ps) {
    if (p.x < x0) x0 = p.x
    if (p.x + p.w > x1) x1 = p.x + p.w
    if (p.y < y0) y0 = p.y
    if (p.y + p.h > y1) y1 = p.y + p.h
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

export function blastBoxOf(w: CamWorld): Box {
  return w.stage.blastZone
}

/**
 * 允许的缩放区间。
 *
 * 下界 = 边界刚好铺满视口（再小就露出虚空）
 * 上界 = 场地刚好铺满视口减去最小留白（再大场地就被裁了）
 */
export function zoomRangeOf(w: CamWorld, tune: CamTuning = CAM_DEFAULTS): { min: number; max: number } {
  const st = stageBoxOf(w)
  const bl = blastBoxOf(w)
  const min = Math.max(tune.viewW / bl.w, tune.viewH / bl.h)
  let max = Math.min(
    (tune.viewW - tune.padStageX * 2) / Math.max(1, st.w),
    (tune.viewH - tune.padStageY * 2) / Math.max(1, st.h),
  )
  // 极窄/极扁的场地会让上界掉到下界以下 —— 此时以"场地可见"为准，宁可露出一点空白
  if (max < min) max = min
  return { min, max }
}

/**
 * 相机中心的可动范围：两条硬约束的交集。
 * 交集为空（缩放刚好卡在某个极值）时退化为中点。
 */
export function camBounds(w: CamWorld, zoom: number, tune: CamTuning = CAM_DEFAULTS) {
  const st = stageBoxOf(w)
  const bl = blastBoxOf(w)
  const halfW = tune.viewW / 2 / zoom
  const halfH = tune.viewH / 2 / zoom

  const sx0 = st.x + st.w - halfW // 场地右边缘不出画
  const sx1 = st.x + halfW // 场地左边缘不出画
  const bx0 = bl.x + halfW
  const bx1 = bl.x + bl.w - halfW
  let minX = Math.max(sx0, bx0)
  let maxX = Math.min(sx1, bx1)
  if (minX > maxX) minX = maxX = (minX + maxX) / 2

  const sy0 = st.y + st.h - halfH
  const sy1 = st.y + halfH
  const by0 = bl.y + halfH
  const by1 = bl.y + bl.h - halfH
  let minY = Math.max(sy0, by0)
  let maxY = Math.min(sy1, by1)
  if (minY > maxY) minY = maxY = (minY + maxY) / 2

  return { minX, maxX, minY, maxY }
}

/**
 * 留白系数：0 = 全员在场地上（用最小留白），1 = 有人跑得很远（用最大留白）。
 *
 * **连续过渡**是关键。上一版是二值判断（有人出界就换成大留白），
 * 于是"角色刚好跨过场地边线"这一帧会让留白从 40 跳到 96，
 * 缩放跟着跳一下——玩家看到的就是画面"啪"地缩了一下。
 * 现在按越界距离 / padBlendRange 线性过渡。
 */
function padBlendOf(
  w: CamWorld,
  box: { minX: number; maxX: number; minY: number; maxY: number },
  tune: CamTuning,
): number {
  const st = stageBoxOf(w)
  const ox = Math.max(0, st.x - box.minX, box.maxX - (st.x + st.w))
  const oy = Math.max(0, st.y - box.minY, box.maxY - (st.y + st.h))
  return clamp(Math.max(ox, oy) / Math.max(1, tune.padBlendRange), 0, 1)
}

/** 给定取景框，算出为了把它装进视口需要的缩放（已夹进合法区间） */
export function zoomForBox(
  w: CamWorld,
  box: { minX: number; maxX: number; minY: number; maxY: number },
  tune: CamTuning = CAM_DEFAULTS,
): number {
  const boxW = Math.max(1, box.maxX - box.minX)
  const boxH = Math.max(1, box.maxY - box.minY)
  const blend = padBlendOf(w, box, tune)
  const padX = tune.padStageX + (tune.padFighterX - tune.padStageX) * blend
  const padY = tune.padStageY + (tune.padFighterY - tune.padStageY) * blend
  const range = zoomRangeOf(w, tune)
  const fit = Math.min(
    (tune.viewW - padX * 2) / boxW,
    (tune.viewH - padY * 2) / boxH,
  )
  return clamp(fit, range.min, range.max)
}

export interface CamTarget {
  /** 目标中心（世界坐标，已含前视、已夹在 camBounds 内） */
  tx: number
  ty: number
  /** 目标缩放 */
  zoom: number
  /** 取景包围盒（世界坐标，**已含场地**，所以恒 ⊇ 场地） */
  box: { minX: number; maxX: number; minY: number; maxY: number }
  /** 有几个角色在场地上（不含复活中）。0 表示没人 */
  onStageCount: number
  /** 有没有角色跑出场地的横向范围 */
  anyOutside: boolean
}

/**
 * 算出这一帧相机"想去哪"——纯函数，不含任何平滑状态。
 */
export function computeCameraTarget(
  w: CamWorld,
  tune: CamTuning = CAM_DEFAULTS,
): CamTarget {
  const st = stageBoxOf(w)

  // 取景框从**场地**开始，不是从角色开始 —— 这样场地永远完整可见。
  let minX = st.x
  let maxX = st.x + st.w
  let minY = st.y
  let maxY = st.y + st.h

  let vxSum = 0
  let vySum = 0
  let n = 0
  let onStage = 0
  let outside = false

  for (const f of w.fighters) {
    // 复活中的角色不计入取景，否则镜头会死盯着出生点
    if (f.respawnTimer > 0) continue
    const h = f.crouching ? tune.crouchH : tune.standH
    const top = f.y - h - tune.headroom
    if (f.x < minX) minX = f.x
    if (f.x > maxX) maxX = f.x
    if (top < minY) minY = top
    if (f.y > maxY) maxY = f.y
    vxSum += f.vx
    vySum += f.vy
    n++
    const inX = f.x >= st.x && f.x <= st.x + st.w
    const inY = h > 0 && top >= st.y - 4 && f.y <= st.y + st.h + 4
    if (inX && inY) onStage++
    else outside = true
  }

  const wantZoom = zoomForBox(w, { minX, maxX, minY, maxY }, tune)

  const frames = tune.leadTime * 60
  const leadX = n > 0 ? clamp((vxSum / n) * frames, -tune.leadMaxX, tune.leadMaxX) : 0
  const leadY = n > 0 ? clamp((vySum / n) * frames, -tune.leadMaxY, tune.leadMaxY) : 0

  const b = camBounds(w, wantZoom, tune)
  const tx = clamp((minX + maxX) / 2 + leadX, b.minX, b.maxX)
  const ty = clamp((minY + maxY) / 2 + leadY, b.minY, b.maxY)

  return { tx, ty, zoom: wantZoom, box: { minX, maxX, minY, maxY }, onStageCount: onStage, anyOutside: outside }
}

/**
 * 每渲染帧推进相机。
 *
 * 所有平滑都用「60Hz 等效步长」换算（`1 - (1-k)^step`），
 * 这样 144Hz 屏幕上的镜头不会比 60Hz 快一倍多 —— 这是最容易漏的帧率依赖。
 */
/**
 * 把相机**限速**收进可动范围（不是硬夹）。
 *
 * 可动范围 = 场地可见 ∩ 视口不出界，两者都是缩放的函数。
 * 平滑盒子滞后时范围会突然变窄，硬夹就会在那一帧把相机拽走几百像素，
 * 观感是"画面被猛拽了一下"。限速的代价是最多露几帧边界外的暗场，
 * 而那正好被暗角与背景兜住——比镜头抽一下便宜得多。
 */
function settleBounds(
  cam: CamState,
  b: { minX: number; maxX: number; minY: number; maxY: number },
  step: number,
): void {
  const maxStep = 200 * step
  cam.x += clamp(clamp(cam.x, b.minX, b.maxX) - cam.x, -maxStep, maxStep)
  cam.y += clamp(clamp(cam.y, b.minY, b.maxY) - cam.y, -maxStep, maxStep)
}

export function stepCamera(
  cam: CamState,
  w: CamWorld,
  dtMs: number,
  tune: CamTuning = CAM_DEFAULTS,
): CamTarget {
  const step = Math.min(4, Math.max(0.001, dtMs / (1000 / 60)))
  const range = zoomRangeOf(w, tune)
  const t = computeCameraTarget(w, tune)

  if (!cam.init) {
    cam.bx0 = t.box.minX
    cam.bx1 = t.box.maxX
    cam.by0 = t.box.minY
    cam.by1 = t.box.maxY
    cam.boxInit = true
    cam.x = t.tx
    cam.y = t.ty
    cam.zoom = t.zoom
    cam.zoomTarget = t.zoom
    cam.init = true
    return t
  }

  // ---- 1. 取景框低通：击飞造成的盒子暴涨/暴缩先被磨平 ----
  const bk = 1 - Math.pow(1 - tune.boxK, step)
  cam.bx0 += (t.box.minX - cam.bx0) * bk
  cam.bx1 += (t.box.maxX - cam.bx1) * bk
  cam.by0 += (t.box.minY - cam.by0) * bk
  cam.by1 += (t.box.maxY - cam.by1) * bk

  // 平滑后的盒子永远不能小于真实盒子（否则会有人出画）——单向兜底：
  // 真盒子比平滑盒子大时，直接把那一侧推出去，宁可跳一下也不能丢人。
  if (t.box.minX < cam.bx0) cam.bx0 = t.box.minX
  if (t.box.maxX > cam.bx1) cam.bx1 = t.box.maxX
  if (t.box.minY < cam.by0) cam.by0 = t.box.minY
  if (t.box.maxY > cam.by1) cam.by1 = t.box.maxY

  const sBox = { minX: cam.bx0, maxX: cam.bx1, minY: cam.by0, maxY: cam.by1 }
  const zoomRaw = zoomForBox(w, sBox, tune)

  // ---- 2. 缩放迟滞 ----
  // 拉远（视角变大）是安全方向：晚一帧就可能有人出画，所以立刻跟。
  // 推近（视角变小）纯粹是审美：必须连续满足阈值一段时间才走，
  // 否则"打完一套回到站桩"会立刻推近，"下一个连段又拉远"——这就是缩放泵。
  if (zoomRaw < cam.zoom - 0.004) {
    cam.zoomTarget = zoomRaw
    cam.zoomHold = 0
  } else if (zoomRaw > cam.zoomTarget + tune.zoomInThreshold) {
    cam.zoomHold += step
    if (cam.zoomHold >= tune.zoomInHold) cam.zoomTarget = zoomRaw
  } else if (Math.abs(zoomRaw - cam.zoomTarget) <= tune.zoomDeadband) {
    cam.zoomHold = 0
  } else {
    cam.zoomHold = Math.max(0, cam.zoomHold - step * 0.5)
  }

  cam.zoomTarget = clamp(cam.zoomTarget, range.min, range.max)
  const zk = cam.zoomTarget < cam.zoom ? tune.zoomOutK : tune.zoomInK
  cam.zoom += (cam.zoomTarget - cam.zoom) * (1 - Math.pow(1 - zk, step))
  // The moving frame is bounded at every render step, including during interpolation.
  cam.zoom = clamp(cam.zoom, range.min, range.max)

  // ---- 3. 平移 ----
  // 目标中心用**平滑盒子**算，再用当帧的真实盒子兜底夹一次，
  // 保证任何时候两个角色都在画面里。
  const frames = tune.leadTime * 60
  let vxSum = 0
  let vySum = 0
  let n = 0
  for (const f of w.fighters) {
    if (f.respawnTimer > 0) continue
    vxSum += f.vx
    vySum += f.vy
    n++
  }
  const leadX = n > 0 ? clamp((vxSum / n) * frames, -tune.leadMaxX, tune.leadMaxX) : 0
  const leadY = n > 0 ? clamp((vySum / n) * frames, -tune.leadMaxY, tune.leadMaxY) : 0
  const b = camBounds(w, cam.zoom, tune)
  const tx = clamp((sBox.minX + sBox.maxX) / 2 + leadX, b.minX, b.maxX)
  const ty = clamp((sBox.minY + sBox.maxY) / 2 + leadY, b.minY, b.maxY)

  const dxRaw = tx - cam.x
  const dyRaw = ty - cam.y
  const dx = Math.abs(dxRaw) < tune.deadX ? 0 : dxRaw - Math.sign(dxRaw) * tune.deadX
  const dy = Math.abs(dyRaw) < tune.deadY ? 0 : dyRaw - Math.sign(dyRaw) * tune.deadY

  const dist = Math.hypot(dx, dy)
  const k = clamp(tune.panBase + (dist / 420) * tune.panSlope, tune.panBase, tune.panMax)
  const alpha = 1 - Math.pow(1 - k, step)

  // 本帧起始位置：平移 + 收范围 + 兜底三处都会动相机，
  // 出口处统一按"这一帧总共走了多远"限速，避免三处上限叠加成一次猛拽。
  const frameX = cam.x
  const frameY = cam.y

  cam.x += dx * alpha
  cam.y += dy * alpha

  // 缩放刚变过，可动范围也跟着变了 —— 再收一次，别露出边界外的虚空。
  // 注意是**限速收**而不是硬夹：可动范围本身是缩放的函数，
  // 平滑盒子滞后时范围会突然变窄，硬夹等于把相机一帧拽几百像素。
  settleBounds(cam, b, step)

  // ---- 4. 软兜底：允许短暂超出 8%，但会被慢慢拉回来 ----
  // 不用硬夹：硬夹会在"角色刚好压到画面边缘"时每帧把相机顶回去，
  // 那又变成另一种抖。这里给 8% 的宽容带，超出去的按 0.25 的系数收，
  // 配合出界指示器，观感是"冲向画面外又被追上"，而不是"画面被顶住"。
  const halfW = tune.viewW / (2 * cam.zoom)
  const halfH = tune.viewH / (2 * cam.zoom)
  const slackX = halfW * 1.08
  const slackY = halfH * 1.08
  const pullK = 1 - Math.pow(1 - 0.25, step)
  // 单帧纠偏有上限：瞬移/复活/被击飞到极远时，盒子会一跳几千像素，
  // 按 25% 纠偏等于一帧推几百像素 —— 那和"瞬移"没区别，观感是画面被人拽了一下。
  // 上限 140px/60Hz帧 保证补得动、但看上去是"追上去"而不是"被拽过去"。
  const maxPull = 140 * step
  if (t.box.maxX - cam.x > slackX) {
    cam.x += clamp((t.box.maxX - cam.x - slackX) * pullK, 0, maxPull)
  }
  if (t.box.minX - cam.x < -slackX) {
    cam.x += clamp((t.box.minX - cam.x + slackX) * pullK, -maxPull, 0)
  }
  if (t.box.maxY - cam.y > slackY) {
    cam.y += clamp((t.box.maxY - cam.y - slackY) * pullK, 0, maxPull)
  }
  if (t.box.minY - cam.y < -slackY) {
    cam.y += clamp((t.box.minY - cam.y + slackY) * pullK, -maxPull, 0)
  }
  settleBounds(cam, b, step)

  // ---- 5. 整帧总位移限速 ----
  // 上面三步（平移、可动范围收敛、出界兜底）各有各上限，叠加起来仍可能一帧走 300+ 像素。
  // 镜头单帧的最大位移是"会不会看起来像瞬移"的唯一判据，所以在出口处统一收一次。
  const maxTotal = 210 * step
  cam.x = frameX + clamp(cam.x - frameX, -maxTotal, maxTotal)
  cam.y = frameY + clamp(cam.y - frameY, -maxTotal, maxTotal)

  // 震屏衰减按帧率换算
  if (cam.shake > 0.05) {
    cam.shake *= Math.pow(tune.shakeDecay, step)
    cam.shakePhase += step
  } else {
    cam.shake = 0
  }

  return t
}

export interface ScreenPoint {
  x: number
  y: number
}

/** 世界坐标 → 屏幕坐标 */
export function screenOf(
  cam: CamState,
  wx: number,
  wy: number,
  tune: CamTuning = CAM_DEFAULTS,
): ScreenPoint {
  return {
    x: (wx - cam.x) * cam.zoom + tune.viewW / 2,
    y: (wy - cam.y) * cam.zoom + tune.viewH / 2,
  }
}

/** 屏幕坐标 → 世界坐标（调试叠加层用） */
export function worldOf(
  cam: CamState,
  sx: number,
  sy: number,
  tune: CamTuning = CAM_DEFAULTS,
): ScreenPoint {
  return {
    x: (sx - tune.viewW / 2) / cam.zoom + cam.x,
    y: (sy - tune.viewH / 2) / cam.zoom + cam.y,
  }
}

/** 当前视口覆盖的世界矩形 */
export function viewportOf(cam: CamState, tune: CamTuning = CAM_DEFAULTS): Box {
  const w = tune.viewW / cam.zoom
  const h = tune.viewH / cam.zoom
  return { x: cam.x - w / 2, y: cam.y - h / 2, w, h }
}

export interface Offscreen {
  /** 出画方向（单位向量，四向或斜向） */
  dirX: number
  dirY: number
  /** 锚点（已夹进安全框的屏幕坐标）—— 箭头/角标画在这里 */
  sx: number
  sy: number
  /** 角色胸口在画面上的真实投影（可能跑出屏幕，角标可据此算距离） */
  px: number
  py: number
  /** 该方向被夹了几次：2 表示卡在角上，需要画角标而不是单边箭头 */
  edges: number
}

/**
 * 某人在当前镜头下是否出画，以及出画方向。
 * 返回 null 表示在画面内。
 *
 * `margin` 是安全框内缩（屏幕像素），取横向与纵向两个方向，所以四角与上下左右是同一套逻辑。
 */
export function offscreenOf(
  cam: CamState,
  f: CamFighter,
  margin: number,
  tune: CamTuning = CAM_DEFAULTS,
  bottomInset = 0,
): Offscreen | null {
  const h = f.crouching ? tune.crouchH : tune.standH
  // 取胸口而不是脚底：脚底在场地下沿时算"在场地上"，不该触发角标
  const py0 = f.y - h * 0.55
  const p = screenOf(cam, f.x, py0, tune)
  const lo = margin
  const hi = tune.viewW - margin
  const top = margin
  const bot = tune.viewH - margin - bottomInset

  const inX = p.x >= lo && p.x <= hi
  const inY = p.y >= top && p.y <= bot
  if (inX && inY) return null

  const sx = clamp(p.x, lo, hi)
  const sy = clamp(p.y, top, bot)
  const len = Math.hypot(p.x - sx, p.y - sy) || 1
  let edges = 0
  if (p.x < lo || p.x > hi) edges++
  if (p.y < top || p.y > bot) edges++
  return { dirX: (p.x - sx) / len, dirY: (p.y - sy) / len, sx, sy, px: p.x, py: p.y, edges }
}

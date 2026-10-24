/**
 * 角色美术：用 SVG 路径当矢量贴图
 *
 * 为什么是 SVG 路径而不是图片：
 *   · 当前渲染是 Canvas 2D，`new Path2D(d)` 可以直接吃 SVG 的 `d` 字符串 ——
 *     等于零成本拿到矢量素材，不需要图集、不需要加载、不需要处理 DPR；
 *   · 角色尺寸在屏幕上是 64–96 逻辑像素且随缩放变，位图会糊，路径不会；
 *   · 素材以代码形式进 Git，diff 可读、可 review、可程序化生成。
 * 这是"先用 SVG 代替"的落地方式：拿到的是真实矢量剪影，不是占位矩形。
 *
 * 坐标约定（所有肢体件都一样）：
 *   枢轴在 (0, 0)，沿 **+x** 延伸到 x = 1，厚度居中在 y ∈ [-0.5, 0.5]。
 *   绘制时按 `len × thick` 缩放，所以同一份路径可以画上臂也能画小腿。
 *
 * 层级与 pivot 仍由 `rig.json` 那套思路管：谁绕谁转由调用方（drawLimbs）决定，
 * 这里只负责"一节肢体长什么样"。
 */

export interface PartArt {
  /** SVG path，x ∈ [0,1]、y ∈ [-0.5,0.5] */
  d: string
  /** 路径名义宽度（缩放基准） */
  w: number
  /** 路径名义高度 */
  h: number
}

export interface CharArt {
  /** 布料主色 / 暗部 */
  cloth: string
  clothDark: string
  /** 甲片/护具 */
  armor: string
  /** 描边（不用纯黑，纯黑在深色背景上会"挖洞"） */
  ink: string
  /** 高光点缀 */
  accent: string
  /** 躯干（枢轴在髋部，向 -y 长到 -1） */
  torso: PartArt
  /** 头（枢轴在头部中心） */
  head: PartArt
  /** 头饰：不同角色一眼能分开的关键 */
  crest: 'bandana' | 'hood' | 'helm' | 'none'
  /** 武器（挂在出击手的末端；null 表示空手） */
  weapon: PartArt | null
  /** 武器长度系数（相对臂长） */
  weaponScale: number
}

/* ── 肢体件：共用一套，靠颜色与长度区分角色体型 ───────────── */

/** 上臂/大腿：靠枢轴一端粗，往末端收 */
export const ART_UPPER: PartArt = {
  w: 1,
  h: 1,
  d: 'M0,-0.5 C0.28,-0.5 0.78,-0.34 1,-0.2 L1,0.2 C0.78,0.34 0.28,0.5 0,0.5 Z',
}

/** 前臂/小腿：中段略鼓，末端有护腕收口 */
export const ART_LOWER: PartArt = {
  w: 1,
  h: 1,
  d: 'M0,-0.38 L0.74,-0.32 L0.92,-0.2 L0.96,-0.12 L0.96,0.12 L0.92,0.2 L0.74,0.32 L0,0.38 Z',
}

/** 脚：靴子，前掌翘起 */
export const ART_FOOT: PartArt = {
  w: 1,
  h: 1,
  d: 'M-0.12,-0.44 L0.52,-0.44 L0.86,-0.16 L1,-0.02 L1,0.3 L0.86,0.44 L-0.12,0.44 Z',
}

/** 拳：握拳的手 */
export const ART_FIST: PartArt = {
  w: 1,
  h: 1,
  d: 'M0.1,-0.5 L0.72,-0.42 L0.96,-0.16 L0.96,0.22 L0.7,0.48 L0.1,0.5 Z',
}

/* ── 头与躯干 ─────────────────────────────────────────── */

/** 标准头：圆颅 + 略收的下颌，枢轴在中心 */
const HEAD_BASE: PartArt = {
  w: 1,
  h: 1.12,
  d: 'M0,-0.5 C0.32,-0.5 0.5,-0.26 0.5,0 C0.5,0.26 0.3,0.5 0,0.5 C-0.3,0.5 -0.5,0.26 -0.5,0 C-0.5,-0.26 -0.32,-0.5 0,-0.5 Z',
}

/** 躯干：髋部收、肩部展的对襟短打。枢轴在髋，向 -y 长到 -1 */
const TORSO_BASE: PartArt = {
  w: 1.34,
  h: 1,
  d: 'M-0.5,0 L0.5,0 L0.66,-0.55 L0.5,-0.82 L0.34,-0.94 L0.34,-1 L-0.34,-1 L-0.34,-0.94 L-0.5,-0.82 L-0.66,-0.55 Z',
}

/* ── 四个角色 ─────────────────────────────────────────── */

export const CHAR_ART: Record<string, CharArt> = {
  // 磨刀匠·砺：中速压制，破布短打 + 布巾 + 斩骨刀
  li: {
    cloth: '#8a7a63',
    clothDark: '#4d4336',
    armor: '#b8a583',
    ink: '#0b0f16',
    accent: '#d8c9a6',
    torso: TORSO_BASE,
    head: HEAD_BASE,
    crest: 'bandana',
    weapon: {
      w: 1,
      h: 1,
      // 斩骨刀：厚背、宽刃、末端上翘
      d: 'M0,-0.16 L0.52,-0.46 L0.96,-0.4 L1,-0.02 L0.94,0.2 L0.5,0.26 L0,0.14 Z',
    },
    weaponScale: 0.92,
  },

  // 灯守·葵：轻快位移，长衣 + 兜帽 + 提灯（提灯不参与判定，纯视觉）
  aoi: {
    cloth: '#5f8fd4',
    clothDark: '#2b4372',
    armor: '#9dc0f0',
    ink: '#0b0f16',
    accent: '#ffd84d',
    torso: TORSO_BASE,
    head: HEAD_BASE,
    crest: 'hood',
    weapon: {
      w: 1,
      h: 1,
      // 灯杆 + 灯笼轮廓（灯体本身由 drawFighter 加发光点）
      d: 'M0,-0.08 L0.62,-0.08 L0.62,-0.34 L1,-0.34 L1,0.34 L0.62,0.34 L0.62,0.08 L0,0.08 Z',
    },
    weaponScale: 1.05,
  },

  // 铁皮·肯：重型，板甲 + 全盔 + 铁锤
  ken: {
    cloth: '#a8683a',
    clothDark: '#5c3719',
    armor: '#c7a06a',
    ink: '#0b0f16',
    accent: '#e8c88f',
    torso: TORSO_BASE,
    head: HEAD_BASE,
    crest: 'helm',
    weapon: {
      w: 1,
      h: 1,
      // 铁锤：短柄 + 方正锤头
      d: 'M0,-0.1 L0.54,-0.26 L0.98,-0.42 L1,0.42 L0.54,0.26 L0,0.1 Z',
    },
    weaponScale: 1.1,
  },

  // 未解锁位：灰模，剪影也要撑得住
  shu: {
    cloth: '#6b7280',
    clothDark: '#3a4048',
    armor: '#8d95a3',
    ink: '#0b0f16',
    accent: '#b6c2d4',
    torso: TORSO_BASE,
    head: HEAD_BASE,
    crest: 'none',
    weapon: null,
    weaponScale: 1,
  },
}

export function artOf(charId: string): CharArt {
  return CHAR_ART[charId] ?? CHAR_ART.shu!
}

/* ── 绘制 ─────────────────────────────────────────────── */

const pathCache = new Map<string, Path2D>()

function pathOf(d: string): Path2D {
  let p = pathCache.get(d)
  if (!p) {
    p = new Path2D(d)
    pathCache.set(d, p)
  }
  return p
}

/**
 * 画一节肢体：枢轴在 (0,0)，朝 (dx,dy) 方向长 len，厚 thick。
 *
 * 描边不用 `stroke`：非等比缩放下 `lineWidth` 会被拉成一边粗一边细。
 * 改成「先用墨色画一遍放大的同一形状、再用本色画正常大小」——
 * 得到的是等宽外轮廓，而且在任何缩放下都稳定。
 */
export function drawLimb(
  g: CanvasRenderingContext2D,
  art: PartArt,
  dx: number,
  dy: number,
  len: number,
  thick: number,
  fill: string,
  ink: string,
): void {
  const ang = Math.atan2(dy, dx)
  const sx = len / art.w
  const sy = thick / art.h
  const p = pathOf(art.d)

  g.save()
  g.rotate(ang)

  // 外轮廓：同形状放大一圈
  g.scale(sx * 1.16 + 0.6, sy * 1.34 + 0.6)
  g.fillStyle = ink
  g.fill(p)

  // 本体
  g.restore()
  g.save()
  g.rotate(ang)
  g.scale(sx, sy)
  g.fillStyle = fill
  g.fill(p)
  g.restore()
}

/** 在任意局部变换下填充一个部件（头、躯干、武器用） */
export function drawPart(
  g: CanvasRenderingContext2D,
  art: PartArt,
  cx: number,
  cy: number,
  w: number,
  h: number,
  fill: string,
  ink: string,
  rot = 0,
): void {
  const p = pathOf(art.d)
  const sx = w / art.w
  const sy = h / art.h

  g.save()
  g.translate(cx, cy)
  if (rot) g.rotate(rot)
  g.scale(sx * 1.1 + 0.5, sy * 1.12 + 0.5)
  g.fillStyle = ink
  g.fill(p)
  g.restore()

  g.save()
  g.translate(cx, cy)
  if (rot) g.rotate(rot)
  g.scale(sx, sy)
  g.fillStyle = fill
  g.fill(p)
  g.restore()
}

/**
 * 头饰：用矩形/三角做，形状小但区分度最高 ——
 * 三个角色在 70 像素高的时候，能认出来的只有头饰与武器。
 */
export function drawCrest(
  g: CanvasRenderingContext2D,
  kind: CharArt['crest'],
  r: number,
  ink: string,
  accent: string,
): void {
  g.save()
  g.strokeStyle = ink
  g.lineWidth = Math.max(1.4, r * 0.18)
  if (kind === 'bandana') {
    // 布巾：横带 + 后脑飘带
    g.fillStyle = accent
    g.beginPath()
    g.rect(-r * 1.02, -r * 0.42, r * 2.04, r * 0.52)
    g.fill()
    g.stroke()
    g.beginPath()
    g.moveTo(-r * 0.95, -r * 0.3)
    g.lineTo(-r * 1.9, -r * 0.9)
    g.lineTo(-r * 1.75, -r * 0.1)
    g.closePath()
    g.fill()
    g.stroke()
  } else if (kind === 'hood') {
    // 兜帽：上半个圆弧罩住头
    g.fillStyle = accent
    g.beginPath()
    g.arc(0, 0, r * 1.16, Math.PI, Math.PI * 2)
    g.closePath()
    g.fill()
    g.stroke()
  } else if (kind === 'helm') {
    // 全盔：顶盔 + 面甲横条
    g.fillStyle = accent
    g.beginPath()
    g.moveTo(-r * 1.04, -r * 0.5)
    g.lineTo(-r * 0.72, -r * 1.34)
    g.lineTo(r * 0.72, -r * 1.34)
    g.lineTo(r * 1.04, -r * 0.5)
    g.closePath()
    g.fill()
    g.stroke()
    g.fillStyle = ink
    g.beginPath()
    g.rect(-r * 0.82, -r * 0.16, r * 1.64, r * 0.34)
    g.fill()
  }
  g.restore()
}

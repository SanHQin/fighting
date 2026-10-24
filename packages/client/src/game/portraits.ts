/**
 * 角色美术查表。
 *
 * 现状：只有 `li` 有正式立绘（Gemini 出图 → tools/prepare-assets.py 去背 + 切图），
 * 其余角色回落到 `CharSilhouette` 的几何剪影。查表放在 client 而不是写进
 * CharDef，是因为「有没有美术」是表现层的可用性问题，不该进 rulesetHash
 * 也不该影响联机（同一角色，A 有图 B 没图，仍然可以打）。
 *
 * 约定：
 * - `portrait` 用于选人预览、结算大图，比例 3:5，透明底
 * - `icon` 用于 HUD 头像、列表小格，1:1，透明底
 * - 缺项即回落剪影，不要写空串
 */

export type CharArtSet = {
  portrait?: string
  icon?: string
  /** 立绘里人物占的画幅比例，用来裁掉多余留白（0.5 → 只显示中间 50%） */
  portraitFill?: number
}

const ART: Record<string, CharArtSet> = {
  li: {
    portrait: '/assets/characters/li/portrait/li_portrait.webp',
    icon: '/assets/characters/li/portrait/li_icon.webp',
    // prepare-assets.py 已经按内容包围盒裁到贴边了，这里不能再放大，
    // 否则 1.61 倍会直接把头和脚切掉
    portraitFill: 1,
  },
}

export function artOf(id: string): CharArtSet | null {
  const a = ART[id]
  if (!a || (!a.portrait && !a.icon)) return null
  return a
}

export function hasPortrait(id: string): boolean {
  return Boolean(ART[id]?.portrait)
}

export function portraitUrl(id: string): string | null {
  return ART[id]?.portrait ?? null
}

export function iconUrl(id: string): string | null {
  return ART[id]?.icon ?? artOf(id)?.portrait ?? null
}

/**
 * 道具贴图。按「角色 + 道具种类」查，查不到就用通用几何图形。
 *
 * 为什么要按角色分：同一个 `bottle`，砺扔的是酒瓶、换角色可能是别的；
 * 但**玩法上它们是同一种投射物**，所以贴图只是表现层替换，不改任何数值。
 */
const PROPS: Record<string, Partial<Record<string, string>>> = {
  li: {
    bottle: '/assets/characters/li/game/prop_bottle.webp',
  },
}

export function propUrl(charId: string, kind: string): string | null {
  return PROPS[charId]?.[kind] ?? null
}

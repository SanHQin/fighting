/**
 * 简易 AI —— 一个本地 InputSource。
 *
 * 它和联机输入、键盘输入对 `step()` 来说完全一样，产出同样的 InputState。
 * 难度只调"感知延迟"，不做伤害作弊（见 docs/03-combat-system.md 第 6 章）。
 *
 * 随机源走 `createRng(seed)` 而不是 `Math.random()`：AI 虽然不在模拟核心里，
 * 但回放与"同一局跑两次结果一致"的测试需要它也能复现。
 */
import { emptyInput, type Fighter, type InputState } from './sim.ts'
import { createRng, type Rng } from './rng.ts'

﻿/**
 * AI 就是一个本地 InputSource —— 和联机输入同构，产出同样的 InputState。
 * 难度只调感知延迟，不做伤害作弊（见 docs 第 6 章 AI 设计）。
 */
export class SimpleAI {
  private history: [number, number][] = []
  private delayFrames: number
  private wobble: number
  private rng: Rng

  constructor(delayFrames = 16, seed = 0x51ed270b) {
    this.delayFrames = delayFrames
    this.rng = createRng(seed)
    this.wobble = this.rng.next() * 1000
  }

  setDelay(d: number) {
    this.delayFrames = d
  }

  /** 返回本帧该输出的输入（基于 d 帧前看到的世界） */
  think(me: Fighter, foe: Fighter): InputState {
    const inp = emptyInput()
    this.history.push([foe.x, foe.y])
    if (this.history.length < this.delayFrames) return inp
    const seen = this.history.shift() ?? [foe.x, foe.y]
    const [fx, fy] = seen

    const dx = fx - me.x
    const dy = fy - me.y
    const adx = Math.abs(dx)

    this.wobble += 0.07
    // 不用三角函数：AI 走的是「感知延迟 + 抖动」两件事，
    // 一个三角波足够，且不会让人误以为 AI 在跑确定性逻辑。
    const phase = (this.wobble % 2) - 1
    const jitter = phase * 0.6

    // 倒地/眩晕中不乱动
    if (me.knockedDown || me.shieldBreakStun > 0) return inp

    // 想靠近到能打的距离
    if (adx > 60 + jitter * 20) {
      if (dx > 0) inp.right = true
      else inp.left = true
    } else if (adx < 26) {
      if (dx > 0) inp.left = true
      else inp.right = true
    }

    // 够得着就出招。八方向：斜向靠同时按方向和上/下
    if (adx >= 20 && adx <= 58 && Math.abs(dy) < 50 && this.rng.next() < 0.22) {
      inp.attack = true
      if (dy < -34) {
        inp.up = true
        if (this.rng.next() < 0.5) {
          if (dx > 0) inp.right = true
          else inp.left = true
        }
      } else if (dy > 30) {
        inp.down = true
        if (this.rng.next() < 0.5) {
          if (dx > 0) inp.right = true
          else inp.left = true
        }
      } else {
        const r = this.rng.next()
        if (r < 0.5) {
          if (dx > 0) inp.right = true
          else inp.left = true
        } else if (r < 0.7) {
          if (dx > 0) inp.left = true
          else inp.right = true
        }
      }
    }

    // 用必杀：远距离放远程，近距离偶尔投技
    if (me.cooldown[0]! <= 0 && this.rng.next() < 0.05) {
      const sp = me.char.specials[0]
      if (sp) {
        if (sp.kind === 'grab') {
          if (adx < 70) inp.special = true
        } else if (adx > 110) {
          inp.special = true
        } else if (this.rng.next() < 0.3) {
          inp.special = true
        }
      }
    }
    if (me.cooldown[1]! <= 0 && this.rng.next() < 0.02 && adx > 70) inp.special2 = true

    // 对手在上方 → 跳
    if (dy < -40 && me.onGround && this.rng.next() < 0.12) {
      inp.jumpPressed = true
      inp.jumpHeld = true
    }
    if (dy > 80 && !me.onGround && me.vy > 0) inp.down = true
    if (me.onGround && this.rng.next() < 0.015) {
      inp.jumpPressed = true
      inp.jumpHeld = true
    }
    // 随机换成短跳：否则 AI 永远全跳，落点可预测
    if (me.jumpSquat > 0 && this.rng.next() < 0.45) inp.jumpHeld = false

    // 冲刺：远距离偶尔冲上去贴脸，或冲过去接冲拳
    if (!me.onGround && me.airDashes > 0 && me.y > 60 && this.rng.next() < 0.1) {
      inp.dashPressed = true
      inp.dash = true
    } else if (me.onGround && adx > 90 && adx < 260 && me.dashCd <= 0 && this.rng.next() < 0.06) {
      inp.dashPressed = true
      inp.dash = true
    }

    // 防御：对手贴身且正在出招时，有概率下蹲
    if (me.onGround && foe.attackFrame >= 0 && adx < 70 && this.rng.next() < 0.28) {
      inp.shield = true
      inp.down = true
    }

    return inp
  }
}

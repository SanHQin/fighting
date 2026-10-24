/**
 * 客户端唯一的输入设备层：键盘。
 *
 * 模拟内核完全不知道键盘的存在 —— 它只接收 `InputState[]`。
 * 于是"本地双人 / 打 AI / 联机"三种玩法在内核看来是同一种输入来源。
 */
import type { InputState } from '@fighting/battle-core'

const P1_KEYS = {
  left: ['KeyA'],
  right: ['KeyD'],
  up: ['KeyW'],
  down: ['KeyS'],
  jump: ['KeyK'],
  attack: ['KeyJ'],
  special: ['KeyU'],
  special2: ['KeyI'],
  dash: ['KeyL', 'ShiftLeft'],
  jumpAlt: ['Space'],
  attackAlt: ['KeyF'],
}

const P2_KEYS = {
  left: ['ArrowLeft'],
  right: ['ArrowRight'],
  up: ['ArrowUp'],
  down: ['ArrowDown'],
  jump: ['Numpad1'],
  attack: ['Numpad0', 'Period'],
  special: ['Numpad2', 'Comma'],
  special2: ['Numpad3', 'Slash'],
  dash: ['Numpad5'],
  jumpAlt: ['ShiftRight'],
  attackAlt: [] as string[],
}

/** 会滚动页面的键，必须 preventDefault */
const SCROLL_KEYS = [
  'Space',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Slash',
  'Numpad1',
  'Numpad0',
  'Numpad2',
  'Numpad3',
  'Numpad5',
]

export class KeyboardSource {
  private down = new Set<string>()
  private prevJump: [boolean, boolean] = [false, false]
  private prevDash: [boolean, boolean] = [false, false]

  attach(target: Window = window) {
    target.addEventListener('keydown', this.onDown)
    target.addEventListener('keyup', this.onUp)
    target.addEventListener('blur', this.onBlur)
  }

  detach(target: Window = window) {
    target.removeEventListener('keydown', this.onDown)
    target.removeEventListener('keyup', this.onUp)
    target.removeEventListener('blur', this.onBlur)
  }

  private onDown = (e: KeyboardEvent) => {
    if (SCROLL_KEYS.includes(e.code)) e.preventDefault()
    if (e.repeat) return
    this.down.add(e.code)
  }

  private onUp = (e: KeyboardEvent) => {
    this.down.delete(e.code)
  }

  private onBlur = () => {
    this.down.clear()
    this.prevJump = [false, false]
    this.prevDash = [false, false]
  }

  private has(codes: string[] | undefined): boolean {
    if (!codes) return false
    return codes.some((c) => this.down.has(c))
  }

  read(index: 0 | 1): InputState {
    const k = index === 0 ? P1_KEYS : P2_KEYS
    const jumpNow = this.has(k.jump) || this.has(k.jumpAlt)
    const dashNow = this.has(k.dash)
    const inp: InputState = {
      left: this.has(k.left),
      right: this.has(k.right),
      up: this.has(k.up),
      down: this.has(k.down),
      jumpPressed: jumpNow && !this.prevJump[index],
      jumpHeld: jumpNow,
      attack: this.has(k.attack) || this.has(k.attackAlt),
      shield: this.has(k.down),
      special: this.has(k.special),
      special2: this.has(k.special2),
      dashPressed: dashNow && !this.prevDash[index],
      dash: dashNow,
    }
    this.prevJump[index] = jumpNow
    this.prevDash[index] = dashNow
    return inp
  }
}

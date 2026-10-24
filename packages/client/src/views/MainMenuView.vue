<script setup lang="ts">
/**
 * 主菜单。线框见 docs/04-ui-art.md 第 4 章：
 * 顶栏 48px / 左 4 栅格菜单 320 宽 / 右 8 栅格主视觉 / 底栏 40px。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import LogicalViewport from '@/components/LogicalViewport.vue'
import MenuItem from '@/components/MenuItem.vue'
import HintBar from '@/components/HintBar.vue'
import { useFocusGrid, type FocusItem } from '@/composables/useFocusGrid'
import { useSessionStore } from '@/stores'
import { CHARS, STAGES } from '@/mock/data'

const router = useRouter()
const session = useSessionStore()
const user = computed(() => session.user)

const items = ref<FocusItem[]>([
  {
    id: 'solo',
    x: 0,
    y: 0,
    onConfirm: () => router.push({ name: 'mode' }),
  },
  {
    id: 'online',
    x: 0,
    y: 1,
    onConfirm: () => router.push({ name: 'mode', query: { prefer: 'online' } }),
  },
  {
    id: 'settings',
    x: 0,
    y: 2,
    onConfirm: () => router.push({ name: 'settings' }),
  },
  {
    id: 'exit',
    x: 0,
    y: 3,
    onConfirm: () => {
      session.logout()
      router.replace({ name: 'login' })
    },
  },
])

const { focusedId, setFocus } = useFocusGrid(items, { initial: 'solo' })

const menuDefs = [
  { id: 'solo', label: '单机战斗', sub: '本地双人 / 人机对战' },
  { id: 'online', label: '在线对战', sub: '匹配或开房间（尚未接入）' },
  { id: 'settings', label: '设置', sub: '画面、音频、按键' },
  { id: 'exit', label: '退出登录', sub: '' },
]

/** 主视觉轮播，5s 一张。放 onMounted 里，SSR / 非浏览器环境不执行。 */
const slide = ref(0)
const slides = [
  {
    tag: '角色 · 磨刀匠',
    title: '中速压制',
    body: '磨刀匠·砺靠起手速度抢节奏，一次贴地连段能带走半条命。酒瓶铺火区、捕兽夹封退路。',
    accent: '#7c8fa6',
  },
  {
    tag: '角色 · 灯守',
    title: '位移差',
    body: '灯守·葵跑速最快，但体重轻，任何一次读招都可能被终结。弓箭控距离，香蕉皮钓脚步。',
    accent: '#5f8fd4',
  },
  {
    tag: '场地 · 齿轮工坊',
    title: '会动的台面',
    body: '中间那块平台每 5 秒横移一个来回，两边的木板打三下就碎。别把复归路线押在会消失的东西上。',
    accent: '#a8e85c',
  },
  {
    tag: '场地 · 灰烬原',
    title: '地面在烧',
    body: '三个地火喷口轮流出火，底部熔岩定期上涌。这张图不奖励站桩，只奖励一直换位子的人。',
    accent: '#ff8a1f',
  },
]

let slideTimer = 0

onMounted(() => {
  slideTimer = window.setInterval(() => {
    slide.value = (slide.value + 1) % slides.length
  }, 5000)
})

onBeforeUnmount(() => {
  window.clearInterval(slideTimer)
})

function goto(i: number) {
  slide.value = i
  window.clearInterval(slideTimer)
  slideTimer = window.setInterval(() => {
    slide.value = (slide.value + 1) % slides.length
  }, 5000)
}

const ratingPct = computed(() => {
  const r = user.value?.rating ?? 1000
  // 展示用：把 800-1600 映射到 0-100%
  return Math.max(0, Math.min(100, ((r - 800) / 800) * 100))
})
</script>

<template>
  <LogicalViewport tone="brand" scan>
    <div class="menu">
      <!-- 顶栏 48px -->
      <header class="topbar">
        <div class="brand">
          <span class="dot" aria-hidden="true" />
          <span class="name">残灯台</span>
          <span class="ver-chip">EARLY ACCESS</span>
        </div>
        <div class="user" v-if="user">
          <span class="avatar" :style="{ background: `hsl(${user.avatarHue} 55% 42%)` }">
            {{ user.nickname.slice(0, 1) }}
          </span>
          <span class="nick">{{ user.nickname }}</span>
          <span v-if="user.isGuest" class="tag">游客</span>
          <div class="rating" :title="`信誉分 ${user.rating}`">
            <div class="rbar"><div class="rfill" :style="{ width: ratingPct + '%' }" /></div>
            <span class="rnum">{{ user.rating }}</span>
          </div>
        </div>
        <div class="top-actions">
          <button class="icon-btn" title="设置" @click="router.push({ name: 'settings' })">⚙</button>
        </div>
      </header>

      <!-- 主体 -->
      <div class="body">
        <nav class="left">
          <div class="left-head">
            <span class="ui-kicker">MAIN MENU</span>
          </div>
          <MenuItem
            v-for="(m, i) in menuDefs"
            :key="m.id"
            :label="m.label"
            :sub="m.sub"
            :index="i + 1"
            :focused="focusedId === m.id"
            :danger="m.id === 'exit'"
            @hover="setFocus(m.id)"
            @confirm="
              m.id === 'solo'
                ? router.push({ name: 'mode' })
                : m.id === 'settings'
                  ? router.push({ name: 'settings' })
                  : m.id === 'exit'
                    ? (session.logout(), router.replace({ name: 'login' }))
                    : router.push({ name: 'mode', query: { prefer: 'online' } })
            "
          />
          <div class="left-foot">
            <div class="stat">
              <span class="sv ui-num">{{ CHARS.filter((c) => !c.locked).length }}</span>
              <span class="sl">可用角色</span>
            </div>
            <div class="sep" aria-hidden="true" />
            <div class="stat">
              <span class="sv ui-num">{{ STAGES.length }}</span>
              <span class="sl">场地</span>
            </div>
            <div class="sep" aria-hidden="true" />
            <div class="stat">
              <span class="sv ui-num">{{ user?.wins ?? 0 }}<i>/{{ (user?.wins ?? 0) + (user?.losses ?? 0) }}</i></span>
              <span class="sl">战绩</span>
            </div>
          </div>
        </nav>

        <section class="right">
          <Transition name="slide" mode="out-in">
            <div class="feature" :key="slide">
              <div class="art" :style="{ '--accent': slides[slide]!.accent }">
                <span class="art-sheen" aria-hidden="true" />
                <span class="art-glyph" aria-hidden="true" />
                <span class="art-silhouette" aria-hidden="true" />
                <span class="art-tag">{{ slides[slide]!.tag }}</span>
                <span class="art-no ui-num">{{ String(slide + 1).padStart(2, '0') }}</span>
              </div>
              <div class="feature-text">
                <span class="ft-kicker">FEATURED {{ String(slide + 1).padStart(2, '0') }}</span>
                <h2 class="ft">{{ slides[slide]!.title }}</h2>
                <p class="fb">{{ slides[slide]!.body }}</p>
                <div class="dots">
                  <button
                    v-for="(_, i) in slides"
                    :key="i"
                    class="dot-i"
                    :class="{ on: i === slide }"
                    :aria-label="`第 ${i + 1} 张`"
                    @click="goto(i)"
                  >
                    <span class="dot-fill" />
                  </button>
                </div>
              </div>
            </div>
          </Transition>
        </section>
      </div>

      <HintBar
        :hints="[
          { key: '↑↓', label: '选择' },
          { key: 'Enter', label: '确认' },
          { key: 'F1', label: '手柄帮助' },
        ]"
      >
        <span class="live">
          <i class="live-dot" aria-hidden="true" />
          本地离线模式 · 数据写死
        </span>
      </HintBar>
    </div>
  </LogicalViewport>
</template>

<style scoped>
.menu {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: radial-gradient(circle at 20% 24%, var(--bg-2) 0%, var(--bg-0) 60%);
}

/* ---------- 顶栏 ---------- */
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 48px;
  padding: 0 var(--s-5);
  border-bottom: 1px solid var(--line);
  background: color-mix(in srgb, var(--bg-1) 72%, transparent);
}

.brand {
  display: flex;
  align-items: center;
  gap: var(--s-2);
}

.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--brand);
  box-shadow: 0 0 12px var(--brand);
}

.name {
  font-size: var(--fs-small);
  font-weight: 700;
  letter-spacing: 0.16em;
  color: var(--fg-0);
}

.ver-chip {
  padding: 1px 7px;
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: 0.14em;
  color: var(--brand);
  border: 1px solid color-mix(in srgb, var(--brand) 40%, transparent);
  border-radius: 999px;
  opacity: 0.85;
}

.user {
  display: flex;
  align-items: center;
  gap: var(--s-3);
}

.avatar {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  font-size: var(--fs-tiny);
  font-weight: 700;
  color: #fff;
  border: 1px solid var(--ink);
}

.nick {
  font-size: var(--fs-small);
  color: var(--fg-0);
}

.tag {
  padding: 1px 6px;
  font-size: 10px;
  border-radius: var(--r-1);
  color: var(--warn);
  background: color-mix(in srgb, var(--warn) 16%, transparent);
}

.rating {
  display: flex;
  align-items: center;
  gap: var(--s-2);
}

.rbar {
  width: 88px;
  height: 8px;
  border-radius: 4px;
  background: var(--bg-3);
  overflow: hidden;
}

.rfill {
  height: 100%;
  background: linear-gradient(90deg, var(--info), var(--brand));
  transition: width var(--t-slow) var(--ease-out-soft);
}

.rnum {
  font-family: var(--font-num);
  font-size: var(--fs-tiny);
  color: var(--fg-1);
  min-width: 32px;
  text-align: right;
}

.icon-btn {
  width: 30px;
  height: 30px;
  border-radius: var(--r-2);
  color: var(--fg-1);
  font-size: 15px;
  transition: background var(--t-fast) var(--ease-standard);
}

.icon-btn:hover {
  background: var(--bg-3);
  color: var(--fg-0);
}

/* ---------- 主体 ---------- */
.body {
  display: grid;
  grid-template-columns: 4fr 8fr;
  gap: var(--s-7);
  flex: 1;
  min-height: 0;
  padding: var(--s-7) var(--s-6);
}

.left {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: var(--s-1);
  max-width: 320px;
}

.left-head {
  padding: 0 var(--s-5) var(--s-4);
}

/* 左下角三个小统计，给空荡的菜单区补点信息密度 */
.left-foot {
  display: flex;
  align-items: center;
  gap: var(--s-4);
  margin-top: var(--s-6);
  padding: var(--s-4) var(--s-5) 0;
  border-top: 1px solid var(--line);
}

.stat {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.sv {
  font-size: 22px;
  font-weight: 700;
  line-height: 1;
  color: var(--fg-0);
}

.sv i {
  font-style: normal;
  font-size: 13px;
  color: var(--fg-2);
}

.sl {
  font-size: 10px;
  letter-spacing: 0.08em;
  color: var(--fg-2);
}

.sep {
  width: 1px;
  height: 24px;
  background: var(--line);
}

.right {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: var(--s-4);
  min-width: 0;
}

.feature {
  display: grid;
  grid-template-columns: 1.15fr 1fr;
  gap: var(--s-5);
  align-items: center;
  height: 100%;
  max-height: 400px;
}

.art {
  position: relative;
  aspect-ratio: 16 / 9;
  border-radius: var(--r-3);
  border: 1px solid var(--line);
  background:
    radial-gradient(120% 100% at 76% 18%, color-mix(in srgb, var(--accent) 52%, transparent) 0%, transparent 62%),
    linear-gradient(158deg, color-mix(in srgb, var(--accent) 26%, var(--bg-1)) 0%, var(--bg-0) 78%);
  overflow: hidden;
  clip-path: polygon(0 0, 100% 0, 100% calc(100% - 26px), calc(100% - 26px) 100%, 0 100%);
}

/* 斜向高光扫过，让静态色块有材质感 */
.art-sheen {
  position: absolute;
  inset: -40% -10%;
  background: linear-gradient(
    104deg,
    transparent 34%,
    color-mix(in srgb, #fff 9%, transparent) 47%,
    transparent 60%
  );
  transform: translateX(-22%);
  animation: sheen 7.5s var(--ease-standard) infinite;
}

@keyframes sheen {
  0%, 62% {
    transform: translateX(-58%);
  }
  100% {
    transform: translateX(58%);
  }
}

.art-glyph {
  position: absolute;
  right: -8%;
  bottom: -14%;
  width: 58%;
  aspect-ratio: 1;
  border-radius: 50%;
  background: radial-gradient(
    circle,
    color-mix(in srgb, var(--accent) 70%, transparent) 0%,
    transparent 66%
  );
  filter: blur(6px);
}

/* 占位角色剪影：右下一块竖向渐隐，代替还没有的立绘 */
.art-silhouette {
  position: absolute;
  right: 14%;
  bottom: 0;
  width: 26%;
  height: 74%;
  border-radius: 999px 999px 8px 8px;
  background: linear-gradient(
    to top,
    color-mix(in srgb, var(--accent) 58%, #000) 0%,
    color-mix(in srgb, var(--accent) 22%, transparent) 74%,
    transparent 100%
  );
  opacity: 0.5;
  filter: blur(1px);
}

.art-tag {
  position: absolute;
  left: var(--s-3);
  top: var(--s-3);
  padding: 3px 8px;
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: 0.1em;
  color: var(--fg-0);
  background: rgba(5, 6, 10, 0.62);
  border: 1px solid color-mix(in srgb, var(--accent) 55%, transparent);
  border-radius: var(--r-1);
  backdrop-filter: blur(3px);
}

/* 右下角大号序号，被裁角切掉一部分，制造"版面被裁"的感觉 */
.art-no {
  position: absolute;
  right: 10px;
  bottom: -6px;
  font-size: 52px;
  font-weight: 800;
  line-height: 1;
  letter-spacing: -0.02em;
  color: color-mix(in srgb, var(--accent) 46%, transparent);
}

.feature-text {
  display: flex;
  flex-direction: column;
  gap: var(--s-3);
  min-width: 0;
}

.ft-kicker {
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: 0.2em;
  color: var(--fg-2);
}

.ft {
  margin: 0;
  font-size: 30px;
  font-weight: 800;
  line-height: 1.2;
  letter-spacing: 0.01em;
  color: var(--fg-0);
}

.fb {
  margin: 0;
  font-size: var(--fs-small);
  line-height: 1.8;
  color: var(--fg-1);
}

/* 圆点改成 24px 的短条，当前项填充进度动画（=5s 切换节奏） */
.dots {
  display: flex;
  gap: var(--s-2);
  margin-top: var(--s-2);
}

.dot-i {
  position: relative;
  width: 24px;
  height: 3px;
  padding: 0;
  border: none;
  border-radius: 2px;
  background: var(--line-strong);
  overflow: hidden;
  transition: width var(--t-mid) var(--ease-out-soft);
}

.dot-i:hover {
  background: var(--fg-2);
}

.dot-i.on {
  width: 44px;
  background: color-mix(in srgb, var(--brand) 24%, var(--line-strong));
}

.dot-fill {
  position: absolute;
  inset: 0;
  transform-origin: left center;
  transform: scaleX(0);
  background: var(--brand);
  border-radius: 2px;
}

.dot-i.on .dot-fill {
  animation: dotrun 5000ms linear forwards;
}

@keyframes dotrun {
  from {
    transform: scaleX(0);
  }
  to {
    transform: scaleX(1);
  }
}

.live {
  display: inline-flex;
  align-items: center;
  gap: var(--s-2);
  font-size: var(--fs-tiny);
  color: var(--fg-2);
}

.live-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--success);
  box-shadow: 0 0 8px var(--success);
  animation: livepulse 2.4s var(--ease-standard) infinite;
}

@keyframes livepulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}

/* 轮播转场 */
.slide-enter-active {
  transition: opacity var(--t-slow) var(--ease-out-soft),
    transform var(--t-slow) var(--ease-out-soft);
}
.slide-leave-active {
  transition: opacity var(--t-mid) var(--ease-in-hard);
}
.slide-enter-from {
  opacity: 0;
  transform: translateX(16px);
}
.slide-leave-to {
  opacity: 0;
}
</style>

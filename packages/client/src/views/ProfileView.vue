<script setup lang="ts">
/**
 * 个人主页。meta.requireRegistered，游客会被路由守卫挡回主菜单。
 * 数据全部来自 mock；接后端后换成 GET /api/users/:id 与 GET /api/matches?uid=。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import LogicalViewport from '@/components/LogicalViewport.vue'
import PageHeader from '@/components/PageHeader.vue'
import HintBar from '@/components/HintBar.vue'
import CharPortrait from '@/components/CharPortrait.vue'
import { useSessionStore } from '@/stores'
import { ME, charById } from '@/mock/data'

const route = useRoute()
const router = useRouter()
const session = useSessionStore()

/** 看自己的主页用 session，看别人的用写死的样例 */
const isSelf = computed(() => !route.params.id || route.params.id === String(session.user?.uid))
const profile = computed(() => (isSelf.value ? session.user ?? ME : ME))

const total = computed(() => profile.value.wins + profile.value.losses)
const winRate = computed(() =>
  total.value === 0 ? 0 : Math.round((profile.value.wins / total.value) * 100),
)

/** 段位分档，纯展示 */
const tier = computed(() => {
  const r = profile.value.rating
  if (r >= 1500) return { name: '大师', color: 'var(--danger)' }
  if (r >= 1300) return { name: '钻石', color: 'var(--info)' }
  if (r >= 1100) return { name: '白金', color: 'var(--brand)' }
  if (r >= 900) return { name: '黄金', color: 'var(--warn)' }
  return { name: '青铜', color: 'var(--fg-2)' }
})

/** 假战绩：结构对齐 docs/07-database.md 的 matches 表 */
const history = [
  { id: 'm-1042', foe: 'aoi', win: true, stage: '残灯台', dmg: 312, at: '2 小时前' },
  { id: 'm-1038', foe: 'ken', win: false, stage: '残灯台', dmg: 148, at: '昨天' },
  { id: 'm-1031', foe: 'li', win: true, stage: '残灯台', dmg: 402, at: '昨天' },
  { id: 'm-1022', foe: 'aoi', win: true, stage: '残灯台', dmg: 266, at: '3 天前' },
  { id: 'm-1015', foe: 'ken', win: false, stage: '残灯台', dmg: 91, at: '3 天前' },
]

/** 最常用角色，按场次排序 */
const mains = computed(() => ['li', 'aoi', 'ken'].map((id) => charById(id)!).filter(Boolean))

const tab = ref<'history' | 'chars'>('history')

/** Q/E 切页签、ESC 返回，与设置页保持同一套键位约定 */
function onKeyDown(e: KeyboardEvent) {
  if (e.code === 'KeyQ' || e.code === 'KeyE') {
    tab.value = tab.value === 'history' ? 'chars' : 'history'
    e.preventDefault()
  } else if (e.code === 'Escape' || e.code === 'Backspace') {
    router.push({ name: 'menu' })
    e.preventDefault()
  }
}

onMounted(() => window.addEventListener('keydown', onKeyDown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeyDown))
</script>

<template>
  <LogicalViewport tone="neutral">
    <div class="profile">
      <PageHeader
        kicker="PROFILE"
        :title="isSelf ? '个人主页' : '玩家主页'"
        :sub="isSelf ? '占位数据 —— 战绩接口接通后这里换成真实记录。' : '别人的主页只显示公开战绩。'"
        back="返回主菜单"
      >
        <span class="uid ui-num">UID {{ profile.uid }}</span>
      </PageHeader>

      <div class="body">
        <!-- 左：身份卡 -->
        <aside class="idcard">
          <div class="avatar" :style="{ background: `hsl(${profile.avatarHue} 55% 42%)` }">
            {{ profile.nickname.slice(0, 1) }}
          </div>
          <h2 class="nick">{{ profile.nickname }}</h2>
          <div class="tier" :style="{ color: tier.color, borderColor: tier.color }">
            {{ tier.name }}
          </div>

          <div class="rating">
            <span class="rl">信誉分</span>
            <span class="rv">{{ profile.rating }}</span>
            <span class="rd">±{{ profile.ratingDev }}</span>
          </div>

          <div class="record">
            <div><b>{{ total }}</b><span>总场次</span></div>
            <div><b class="up">{{ profile.wins }}</b><span>胜</span></div>
            <div><b class="down">{{ profile.losses }}</b><span>负</span></div>
            <div><b>{{ winRate }}%</b><span>胜率</span></div>
          </div>

          <p class="disclaimer">
            这是占位数据。真正的战绩来自
            <code>GET /api/matches?uid={{ profile.uid }}</code>，
            信誉分按 Elo 的 <code>ratingDev</code> 收敛，
            见 06 第 1.1 节与 07 第 1.2 节。
          </p>
        </aside>

        <!-- 右：战绩 / 角色 -->
        <section class="main">
          <nav class="tabs">
            <button class="tab" :class="{ on: tab === 'history' }" @click="tab = 'history'">
              最近战绩
            </button>
            <button class="tab" :class="{ on: tab === 'chars' }" @click="tab = 'chars'">
              常用角色
            </button>
          </nav>

          <Transition name="swap" mode="out-in">
            <!-- 战绩表 -->
            <ul v-if="tab === 'history'" key="h" class="history">
              <li v-for="m in history" :key="m.id" class="hrow" :class="{ win: m.win }">
                <span class="res">{{ m.win ? '胜' : '负' }}</span>
                <span class="foe">
                  对战
                  <b>{{ charById(m.foe)?.displayName }}</b>
                </span>
                <span class="stage">{{ m.stage }}</span>
                <span class="dmg">{{ m.dmg }}<i>%</i></span>
                <span class="at">{{ m.at }}</span>
              </li>
            </ul>

            <!-- 角色 -->
            <ul v-else key="c" class="chars">
              <li v-for="c in mains" :key="c.id" class="crow">
                <CharPortrait :char="c" :height="72" glow />
                <div class="ci">
                  <span class="cn">{{ c.displayName }}</span>
                  <span class="cs">{{ c.tagline }}</span>
                </div>
                <div class="cbar">
                  <div class="cfill" :style="{ width: c.speed * 20 + '%' }" />
                </div>
              </li>
            </ul>
          </Transition>
        </section>
      </div>

      <HintBar :hints="[{ key: 'Q / E', label: '切页签' }, { key: 'ESC', label: '返回' }]" />
    </div>
  </LogicalViewport>
</template>

<style scoped>
.profile {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
}

.uid {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.12em;
  color: var(--fg-2);
  padding: 2px 8px;
  border: 1px solid var(--line);
  border-radius: 999px;
}

.body {
  display: grid;
  grid-template-columns: 340px 1fr;
  gap: var(--s-6);
  flex: 1;
  min-height: 0;
  padding: var(--s-6) var(--s-7);
}

/* 身份卡 */
.idcard {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--s-3);
  padding: var(--s-6) var(--s-5);
  border: 1px solid var(--line);
  border-radius: var(--r-3);
  background: color-mix(in srgb, var(--bg-1) 82%, transparent);
}

.avatar {
  display: grid;
  place-items: center;
  width: 84px;
  height: 84px;
  border-radius: 50%;
  border: 3px solid var(--ink);
  font-size: 34px;
  font-weight: 800;
  color: #fff;
}

.nick {
  margin: 0;
  font-size: var(--fs-h3);
  font-weight: 700;
  color: var(--fg-0);
}

.tier {
  padding: 2px 12px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.18em;
  border: 1px solid;
  border-radius: 999px;
}

.rating {
  display: flex;
  align-items: baseline;
  gap: var(--s-2);
  margin-top: var(--s-2);
}

.rl {
  font-size: var(--fs-tiny);
  color: var(--fg-2);
}

.rv {
  font-family: var(--font-num);
  font-size: var(--fs-h2);
  font-weight: 800;
  color: var(--fg-0);
}

.rd {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--fg-2);
}

.record {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 2px;
  width: 100%;
  margin-top: var(--s-3);
  padding-top: var(--s-3);
  border-top: 1px solid var(--line);
}

.record > div {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.record b {
  font-family: var(--font-num);
  font-size: var(--fs-h3);
  color: var(--fg-0);
}

.record b.up {
  color: var(--success);
}

.record b.down {
  color: var(--danger);
}

.record span {
  font-size: 10px;
  color: var(--fg-2);
}

.disclaimer {
  margin: var(--s-3) 0 0;
  font-size: 11px;
  line-height: 1.8;
  color: var(--fg-2);
  text-align: center;
}

.disclaimer code {
  font-family: var(--font-mono);
  font-size: 10px;
  padding: 1px 4px;
  border-radius: 3px;
  background: var(--bg-0);
  color: var(--fg-1);
}

/* 右侧 */
.main {
  display: flex;
  flex-direction: column;
  gap: var(--s-3);
  min-width: 0;
  min-height: 0;
}

.tabs {
  display: flex;
  gap: var(--s-1);
  border-bottom: 1px solid var(--line);
  padding-bottom: var(--s-2);
}

.tab {
  padding: 6px 14px;
  font-size: var(--fs-small);
  color: var(--fg-2);
  border-radius: var(--r-1);
}

.tab.on {
  color: var(--fg-0);
  background: var(--bg-2);
}

/* 战绩 */
.history {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
  overflow: auto;
}

.hrow {
  display: grid;
  grid-template-columns: 44px 1fr 96px 80px 80px;
  align-items: center;
  gap: var(--s-3);
  padding: var(--s-3) var(--s-4);
  border-left: 3px solid transparent;
  border-radius: var(--r-2);
  background: color-mix(in srgb, var(--bg-1) 55%, transparent);
  font-size: var(--fs-small);
  color: var(--fg-1);
}

.hrow.win {
  border-left-color: var(--brand);
}

.res {
  font-weight: 700;
  color: var(--danger);
}

.hrow.win .res {
  color: var(--brand);
}

.foe b {
  color: var(--fg-0);
}

.stage {
  font-size: var(--fs-tiny);
  color: var(--fg-2);
}

.dmg {
  font-family: var(--font-num);
  text-align: right;
  color: var(--fg-0);
}

.dmg i {
  font-style: normal;
  font-size: 0.7em;
  opacity: 0.6;
}

.at {
  font-size: 11px;
  text-align: right;
  color: var(--fg-2);
}

/* 角色 */
.chars {
  display: flex;
  flex-direction: column;
  gap: var(--s-2);
  margin: 0;
  padding: 0;
  list-style: none;
  overflow: auto;
}

.crow {
  display: grid;
  grid-template-columns: 60px 1fr 140px;
  align-items: center;
  gap: var(--s-4);
  padding: var(--s-3) var(--s-4);
  border-radius: var(--r-2);
  background: color-mix(in srgb, var(--bg-1) 55%, transparent);
}

.ci {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.cn {
  font-size: var(--fs-small);
  font-weight: 600;
  color: var(--fg-0);
}

.cs {
  font-size: 11px;
  line-height: 1.6;
  color: var(--fg-2);
}

.cbar {
  height: 6px;
  border-radius: 3px;
  background: var(--bg-3);
  overflow: hidden;
}

.cfill {
  height: 100%;
  background: linear-gradient(90deg, var(--info), var(--brand));
}

/* 切换 */
.swap-enter-active,
.swap-leave-active {
  transition: opacity var(--t-mid) var(--ease-standard);
}
.swap-enter-from,
.swap-leave-to {
  opacity: 0;
}
</style>

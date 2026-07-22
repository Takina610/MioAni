<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  PhArrowLeft,
  PhX,
  PhUser,
  PhCalendarBlank,
  PhDrop,
  PhBriefcase,
  PhCaretDown,
  PhIdentificationCard,
} from '@phosphor-icons/vue'
import { usePersonOverlayStore } from '../stores/personOverlay'
import { parsePersonId } from '../services/personIds'

const store = usePersonOverlayStore()
const route = useRoute()
const router = useRouter()

const summaryExpanded = ref(false)

const display = computed(() => store.detail || store.seed)
const kindLabel = computed(() => (store.kind === 'character' ? '角色' : '人物'))
const sourceLabel = computed(() => {
  const s = display.value?.source
  if (s === 'bangumi') return 'Bangumi'
  if (s === 'anilist') return 'AniList'
  return s || '—'
})

const GENDER_ZH: Record<string, string> = {
  male: '男',
  female: '女',
  男: '男',
  女: '女',
  unknown: '未知',
  other: '其他',
}

function formatGender(value?: string) {
  if (!value) return ''
  const key = value.trim().toLowerCase()
  return GENDER_ZH[key] || GENDER_ZH[value] || value
}

const facts = computed(() => {
  const d = store.detail
  if (!d) return [] as Array<{ label: string; value: string; icon: 'user' | 'calendar' | 'drop' | 'briefcase' | 'id' }>
  const rows: Array<{ label: string; value: string; icon: 'user' | 'calendar' | 'drop' | 'briefcase' | 'id' }> = []
  if (d.gender) rows.push({ label: '性别', value: formatGender(d.gender), icon: 'user' })
  if (d.birthday) rows.push({ label: '生日', value: d.birthday, icon: 'calendar' })
  if (d.bloodType) rows.push({ label: '血型', value: d.bloodType, icon: 'drop' })
  if (d.careers?.length) rows.push({ label: '职业', value: d.careers.join(' · '), icon: 'briefcase' })
  if (d.contextRole || store.contextRole) {
    rows.push({
      label: store.kind === 'character' ? '作品中身份' : '本职',
      value: d.contextRole || store.contextRole,
      icon: 'id',
    })
  }
  rows.push({ label: '数据源', value: sourceLabel.value, icon: 'briefcase' })
  return rows
})

/** Split long bios into readable paragraphs (BGM often uses \r\n or long run-on JP text). */
const summaryParagraphs = computed(() => {
  const raw = store.detail?.summary?.trim() || ''
  if (!raw) return [] as string[]
  const normalized = raw
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\u3000/g, ' ')
  const byBreak = normalized.split(/\n+/).map((p) => p.trim()).filter(Boolean)
  if (byBreak.length > 1) return byBreak
  // Single blob: soft-split on JP sentence enders when very long
  if (normalized.length > 220) {
    const parts = normalized
      .split(/(?<=[。！？!?])\s*/)
      .map((p) => p.trim())
      .filter(Boolean)
    if (parts.length > 1) return parts
  }
  return [normalized]
})

const summaryLong = computed(() => {
  const text = summaryParagraphs.value.join('')
  return text.length > 280 || summaryParagraphs.value.length > 3
})

const summaryPreview = computed(() => {
  if (!summaryLong.value || summaryExpanded.value) return summaryParagraphs.value
  const joined = summaryParagraphs.value
  if (joined.length > 2) return joined.slice(0, 2)
  const first = joined[0] || ''
  if (first.length <= 220) return joined
  return [`${first.slice(0, 220).trim()}…`]
})

watch(
  () => store.detail?.id,
  () => {
    summaryExpanded.value = false
  },
)

async function closePerson() {
  const animeId = store.returnAnimeId
  store.close()
  if (animeId && (route.name === 'character-detail' || route.name === 'person-detail')) {
    await router.replace({ name: 'anime-detail', params: { id: animeId } })
    store.clearReturn()
    return
  }
  if (route.name === 'character-detail' || route.name === 'person-detail') {
    await router.replace(store.returnAnimeId ? { name: 'anime-detail', params: { id: store.returnAnimeId } } : '/')
  }
  store.clearReturn()
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && store.open) void closePerson()
}

watch(
  () => [route.name, route.params.id] as const,
  async ([name, id]) => {
    if (name !== 'character-detail' && name !== 'person-detail') return
    if (typeof id !== 'string' || !id) return
    if (store.open && store.detail?.id === id) return
    if (store.open && store.seed?.id === id && store.loading) return
    const parsed = parsePersonId(id)
    if (!parsed) return
    if (!store.open || store.seed?.id !== id) {
      await store.openPerson({
        id,
        returnAnimeId: store.returnAnimeId,
      })
    }
  },
)

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
  if (
    (route.name === 'character-detail' || route.name === 'person-detail')
    && typeof route.params.id === 'string'
    && !store.open
  ) {
    void store.openPerson({ id: route.params.id })
  }
})

onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="store.open && display"
      class="person-overlay"
      :class="{ 'is-loading': store.loading }"
      role="dialog"
      aria-modal="true"
      :aria-label="store.title"
    >
      <button class="person-scrim" type="button" aria-label="关闭人物详情" @click="closePerson" />

      <div class="person-surface">
        <div
          class="person-banner"
          :style="display.image ? { backgroundImage: `url(${display.image})` } : undefined"
        />
        <div class="person-banner__shade" />

        <button class="person-close" type="button" aria-label="关闭" @click="closePerson">
          <PhX :size="18" weight="bold" />
        </button>
        <button class="person-back" type="button" aria-label="返回" @click="closePerson">
          <PhArrowLeft :size="16" weight="bold" />
          返回
        </button>

        <div class="person-scroll">
          <!-- Hero: portrait + identity (mirrors anime detail header) -->
          <header class="person-hero">
            <div class="person-portrait">
              <img
                v-if="display.image"
                :src="display.image"
                :alt="display.name || ''"
                decoding="async"
              />
              <div v-else class="person-portrait__ph"><PhUser :size="42" /></div>
            </div>

            <div class="person-hero__body">
              <p class="person-kicker">
                <span>{{ kindLabel }}</span>
                <i aria-hidden="true">·</i>
                <span>{{ sourceLabel }}</span>
              </p>
              <h1 class="person-title">{{ display.name }}</h1>
              <p
                v-if="display.nameAlt && display.nameAlt !== display.name"
                class="person-alt"
              >
                {{ display.nameAlt }}
              </p>

              <div class="person-chips">
                <span v-if="display.contextRole || store.contextRole" class="person-chip person-chip--accent">
                  {{ display.contextRole || store.contextRole }}
                </span>
                <span v-if="store.detail?.gender" class="person-chip">
                  {{ formatGender(store.detail.gender) }}
                </span>
                <span v-if="store.detail?.birthday" class="person-chip">
                  {{ store.detail.birthday }}
                </span>
                <span v-if="store.detail?.bloodType" class="person-chip">
                  {{ store.detail.bloodType }}
                </span>
              </div>

              <p
                v-if="!store.loading && !store.error && summaryParagraphs.length"
                class="person-lead"
              >
                {{ summaryParagraphs[0] }}
              </p>
              <p v-else-if="store.loading" class="person-lead is-muted">正在加载资料…</p>
            </div>
          </header>

          <div v-if="store.error" class="person-error">
            <p>{{ store.error }}</p>
            <button
              type="button"
              @click="store.openPerson({
                id: display.id!,
                name: display.name,
                image: display.image,
                contextRole: store.contextRole,
                returnAnimeId: store.returnAnimeId,
              })"
            >
              重试
            </button>
          </div>

          <div v-else class="person-body">
            <!-- Main column: full profile -->
            <section class="person-panel person-panel--profile" aria-labelledby="person-profile-title">
              <header class="person-panel__head">
                <span>PROFILE</span>
                <h2 id="person-profile-title">人物简介</h2>
              </header>

              <div v-if="store.loading" class="person-loader person-loader--inline" aria-busy="true">
                <div class="detail-loader__prism" aria-hidden="true"><i /><i /><i /></div>
                <p>正在解码人物资料…</p>
              </div>

              <template v-else-if="summaryParagraphs.length">
                <div
                  class="person-bio"
                  :class="{ 'is-collapsed': summaryLong && !summaryExpanded }"
                >
                  <p
                    v-for="(para, idx) in summaryPreview"
                    :key="`${idx}-${para.slice(0, 12)}`"
                    class="person-bio__p"
                  >
                    {{ para }}
                  </p>
                </div>
                <button
                  v-if="summaryLong"
                  type="button"
                  class="person-bio-toggle"
                  :aria-expanded="summaryExpanded"
                  @click="summaryExpanded = !summaryExpanded"
                >
                  {{ summaryExpanded ? '收起简介' : '展开全部简介' }}
                  <PhCaretDown :size="14" weight="bold" :class="{ 'is-open': summaryExpanded }" />
                </button>
              </template>

              <p v-else class="person-empty">该{{ kindLabel }}暂无简介资料。</p>
            </section>

            <!-- Side rail: structured facts (mirrors anime detail meta board) -->
            <aside class="person-panel person-panel--meta" aria-label="基本资料">
              <header class="person-panel__head">
                <span>META</span>
                <h2>基本资料</h2>
              </header>

              <div v-if="store.loading" class="person-meta-skeleton" aria-hidden="true">
                <i /><i /><i /><i />
              </div>

              <dl v-else class="person-meta-list">
                <div v-for="fact in facts" :key="fact.label" class="person-meta-row">
                  <dt>
                    <PhUser v-if="fact.icon === 'user'" :size="14" />
                    <PhCalendarBlank v-else-if="fact.icon === 'calendar'" :size="14" />
                    <PhDrop v-else-if="fact.icon === 'drop'" :size="14" />
                    <PhIdentificationCard v-else-if="fact.icon === 'id'" :size="14" />
                    <PhBriefcase v-else :size="14" />
                    {{ fact.label }}
                  </dt>
                  <dd>{{ fact.value }}</dd>
                </div>
              </dl>
            </aside>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

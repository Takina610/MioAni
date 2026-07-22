<script setup lang="ts">
import { ref } from 'vue'
import { PhX, PhArrowRight, PhCheckCircle, PhWarningCircle } from '@phosphor-icons/vue'
import { useLibraryStore } from '../stores/library'
import { importAniList, importBangumi } from '../services/anime'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()
const store = useLibraryStore()
const source = ref<'bangumi' | 'anilist'>('bangumi')
const username = ref('')
const loading = ref(false)
const error = ref('')
const success = ref('')

async function runImport() {
  error.value = ''; success.value = ''; loading.value = true
  try {
    const result = source.value === 'anilist' ? await importAniList(username.value.trim()) : await importBangumi(username.value.trim())
    store.mergeImport(result)
    success.value = `已同步 ${result.items.length} 部作品`
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '导入失败，请稍后再试'
  } finally { loading.value = false }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="open" class="modal-backdrop" @click.self="emit('close')">
        <section class="import-modal" role="dialog" aria-modal="true" aria-labelledby="import-title">
          <button class="modal-close" type="button" aria-label="关闭" @click="emit('close')"><PhX :size="21" /></button>
          <div class="modal-heading"><span>IMPORT</span><h2 id="import-title">导入你的动画收藏</h2></div>
          <div class="source-tabs" role="tablist">
            <button type="button" :class="{ active: source === 'bangumi' }" @click="source = 'bangumi'"><strong>Bangumi</strong><span>中文条目与收藏进度</span></button>
            <button type="button" :class="{ active: source === 'anilist' }" @click="source = 'anilist'"><strong>AniList</strong><span>国际条目与评分记录</span></button>
          </div>
          <form class="import-form" @submit.prevent="runImport">
            <label for="username">{{ source === 'bangumi' ? 'Bangumi 用户名或 UID' : 'AniList 用户名' }}</label>
            <div class="input-action"><input id="username" v-model="username" autocomplete="username" placeholder="输入公开账号" required /><button type="submit" :disabled="loading"><span>{{ loading ? '同步中' : '开始同步' }}</span><PhArrowRight :size="18" /></button></div>
          </form>
          <p v-if="error" class="form-message error"><PhWarningCircle :size="18" />{{ error }}</p>
          <p v-if="success" class="form-message success"><PhCheckCircle :size="18" weight="fill" />{{ success }}</p>
          <p class="privacy-note">用户名只用于本次 API 请求，收藏数据保存在当前浏览器。</p>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

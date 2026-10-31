<template>
  <el-drawer v-model="visible" :title="content?.title ?? '内容详情'" size="520px">
    <template v-if="content">
      <div class="meta">
        <SharedTags kind="sentiment" :text="content.nlp?.enhanced?.label ?? content.nlp?.sentimentLabel ?? 'neutral'" />
        <SharedTags kind="risk" :text="content.nlp?.riskLevel ?? 'low'" />
        <el-tag size="small" type="info" effect="plain">{{ content.sourceName }}</el-tag>
        <span class="muted">{{ formatTime(content.publishedAt) }}</span>
      </div>

      <el-link v-if="content.url" :href="content.url" target="_blank" type="primary" class="link">查看原文 ↗</el-link>

      <h4>正文</h4>
      <p class="content-text">{{ content.content || '（无正文，点击原文查看）' }}</p>

      <template v-if="content.nlp?.enhanced">
        <h4>LLM 增强（{{ content.nlp.enhanced.modelSource === 'llm' ? 'LLM 模型' : '词典模型' }}）</h4>
        <p class="muted">{{ content.nlp.enhanced.reasoning }}</p>
        <div v-if="content.nlp.enhanced.riskSignals?.length" class="signals">
          <el-tag v-for="s in content.nlp.enhanced.riskSignals" :key="s" type="danger" size="small" class="sig">{{ s }}</el-tag>
        </div>
      </template>

      <template v-if="(content.nlp?.events ?? []).length">
        <h4>结构化事件</h4>
        <div v-for="(ev, i) in content.nlp.events" :key="i" class="event-item">
          <el-tag size="small" :type="ev.impactDirection === 'positive' ? 'danger' : ev.impactDirection === 'negative' ? 'success' : 'info'">
            {{ eventTypeName(ev.type) }}
          </el-tag>
          <span class="muted"> 置信度 {{ (ev.confidence * 100).toFixed(0) }}% · {{ ev.impactDirection === 'positive' ? '正面' : ev.impactDirection === 'negative' ? '负面' : ev.impactDirection === 'uncertain' ? '不确定' : '中性' }}</span>
          <div class="muted">{{ ev.summary }}</div>
          <div v-if="ev.subjects?.length" class="muted">主体：{{ ev.subjects.join('、') }}</div>
        </div>
      </template>

      <template v-if="(content.matches ?? []).length">
        <h4>命中订阅（相关度评分）</h4>
        <div v-for="m in content.matches" :key="m.subscriptionId" class="muted">
          {{ subscriptionName(m.subscriptionId) }} — 得分 {{ m.score }}{{ m.isCoreSubject ? '（核心主体）' : m.isMentionOnly ? '（顺带提及）' : '' }}，命中词「{{ m.keyword }}」
        </div>
      </template>
    </template>
  </el-drawer>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import dayjs from 'dayjs';
import type { ContentEntity } from '@fin/core';
import SharedTags from './SharedTags.vue';

const props = defineProps<{ modelValue: boolean; content: ContentEntity | null; subscriptions?: Array<{ id: string; name: string }> }>();
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void }>();

const visible = computed({ get: () => props.modelValue, set: (v) => emit('update:modelValue', v) });

const formatTime = (t: string | Date) => dayjs(t).format('MM-DD HH:mm');

const EVENT_NAMES: Record<string, string> = {
  policy_change: '政策变化', earnings_forecast: '业绩预告', shareholding_change: '增减持',
  merger_acquisition: '并购重组', regulatory_penalty: '监管处罚', debt_default: '债务违约',
  industry_prosperity: '产业景气', rating_change: '评级变化',
};
const eventTypeName = (t: string) => EVENT_NAMES[t] ?? t;

const subscriptionName = (id: string) => props.subscriptions?.find((s) => s.id === id)?.name ?? id.slice(0, 8);
</script>

<style scoped>
.meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.link { display: block; margin: 8px 0; }
.content-text { white-space: pre-wrap; line-height: 1.7; color: var(--el-text-color-regular); }
h4 { margin: 16px 0 6px; }
.event-item { margin-bottom: 10px; }
.signals .sig { margin-right: 6px; }
</style>

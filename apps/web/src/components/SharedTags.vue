<template>
  <!-- 情绪标签（7 级金融情绪或 3 分类） -->
  <el-tag v-if="kind === 'sentiment'" :type="sentimentType" size="small" effect="light">{{ sentimentText }}</el-tag>
  <!-- 风险等级 -->
  <el-tag v-else-if="kind === 'risk'" :type="riskType" size="small" effect="dark">{{ text }}</el-tag>
  <!-- 信号方向：A股红涨绿跌 -->
  <el-tag v-else-if="kind === 'direction'" :type="directionType" size="small" effect="light">{{ directionText }}</el-tag>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ kind: 'sentiment' | 'risk' | 'direction'; text: string }>();

const sentimentType = computed(() => {
  const t = props.text;
  if (t.startsWith('strong_positive') || t === 'positive' || t === '强利好') return 'danger' as const;
  if (t.startsWith('weak_positive')) return 'warning' as const;
  if (t.startsWith('strong_negative') || t === 'negative' || t === '强利空') return 'success' as const;
  if (t.startsWith('weak_negative')) return 'info' as const;
  if (t === 'risk') return 'danger' as const;
  if (t === 'rumor') return 'warning' as const;
  return 'info' as const;
});

const sentimentText = computed(() => {
  const map: Record<string, string> = {
    strong_positive: '强利好', weak_positive: '弱利好', neutral: '中性',
    weak_negative: '弱利空', strong_negative: '强利空', risk: '风险事件', rumor: '传闻',
    positive: '正面', negative: '负面',
  };
  return map[props.text] ?? props.text;
});

const riskType = computed(() => {
  switch (props.text) {
    case 'critical': return 'danger' as const;
    case 'high': return 'danger' as const;
    case 'medium': return 'warning' as const;
    default: return 'info' as const;
  }
});

const riskText = computed(() => {
  const map: Record<string, string> = { low: '低', medium: '中', high: '高', critical: '极高' };
  return map[props.text] ?? props.text;
});

const directionType = computed(() => (props.text === 'bullish' ? 'danger' as const : props.text === 'bearish' ? 'success' as const : 'info' as const));
const directionText = computed(() => (props.text === 'bullish' ? '看多' : props.text === 'bearish' ? '看空' : '中性'));

const text = riskText;
</script>

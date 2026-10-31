<template>
  <div>
    <el-card shadow="never" class="page-card">
      <template #header>
        <div class="head">
          <span>结构化事件分布（近 7 天，共 {{ dist.totalEvents }} 条事件）</span>
        </div>
      </template>
      <EChart v-if="distOption" :option="distOption" height="260px" />
      <el-empty v-else description="暂无事件数据，等待采集管线识别" :image-size="60" />
    </el-card>

    <el-card shadow="never">
      <template #header>
        <div class="head">
          <span>事件时间线</span>
          <el-select v-model="eventType" placeholder="全部事件类型" clearable size="small" style="width: 180px" @change="load">
            <el-option v-for="(label, key) in EVENT_NAMES" :key="key" :label="label" :value="key" />
          </el-select>
        </div>
      </template>

      <el-table :data="timeline" v-loading="loading" @row-click="openDetail" max-height="520">
        <el-table-column prop="publishedAt" label="时间" width="100">
          <template #default="{ row }">{{ formatTime(row.publishedAt) }}</template>
        </el-table-column>
        <el-table-column label="事件类型" width="110">
          <template #default="{ row }">
            <el-tag size="small" :type="row.event.impactDirection === 'positive' ? 'danger' : row.event.impactDirection === 'negative' ? 'success' : 'info'" effect="light">
              {{ EVENT_NAMES[row.event.type] ?? row.event.type }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="title" label="标题" min-width="300" show-overflow-tooltip />
        <el-table-column label="主体" min-width="140">
          <template #default="{ row }">{{ row.event.subjects?.slice(0, 3).join('、') || '—' }}</template>
        </el-table-column>
        <el-table-column label="置信度" width="80">
          <template #default="{ row }">{{ (row.event.confidence * 100).toFixed(0) }}%</template>
        </el-table-column>
        <el-table-column prop="sourceName" label="来源" width="100" />
      </el-table>
    </el-card>

    <ContentDetailDrawer v-model="drawerVisible" :content="selected" :subscriptions="subscriptions" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import dayjs from 'dayjs';
import { contentsApi, subscriptionsApi } from '../api/client';
import type { ContentEntity, SubscriptionEntity } from '@fin/core';
import EChart from '../components/EChart.vue';
import ContentDetailDrawer from '../components/ContentDetailDrawer.vue';

const EVENT_NAMES: Record<string, string> = {
  policy_change: '政策变化', earnings_forecast: '业绩预告', shareholding_change: '增减持',
  merger_acquisition: '并购重组', regulatory_penalty: '监管处罚', debt_default: '债务违约',
  industry_prosperity: '产业景气', rating_change: '评级变化',
};

const dist = ref<{ totalEvents: number; byType: Record<string, number> }>({ totalEvents: 0, byType: {} });
const timeline = ref<Array<{ contentId: string; title: string; sourceName: string; publishedAt: string; event: any }>>([]);
const subscriptions = ref<SubscriptionEntity[]>([]);
const eventType = ref('');
const loading = ref(false);

const load = async () => {
  loading.value = true;
  try {
    dist.value = await contentsApi.eventDistribution(7);
    timeline.value = await contentsApi.eventTimeline({ days: 7, limit: 80, type: eventType.value || undefined });
  } finally {
    loading.value = false;
  }
};

onMounted(async () => {
  subscriptions.value = await subscriptionsApi.list();
  await load();
});

const distOption = computed(() => {
  const entries = Object.entries(dist.value.byType).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return null;
  return {
    grid: { left: 90, right: 30, top: 10, bottom: 24 },
    xAxis: { type: 'value', minInterval: 1 },
    yAxis: { type: 'category', data: entries.map(([k]) => EVENT_NAMES[k] ?? k).reverse() },
    series: [{ type: 'bar', data: entries.map(([, v]) => v).reverse(), barWidth: 16, itemStyle: { borderRadius: [0, 8, 8, 0] }, label: { show: true, position: 'right' } }],
  };
});

const formatTime = (t: string | Date) => dayjs(t).format('MM-DD HH:mm');

const drawerVisible = ref(false);
const selected = ref<ContentEntity | null>(null);
const openDetail = (row: any) => {
  contentsApi
    .get(row.contentId)
    .then((c) => {
      selected.value = c;
      drawerVisible.value = true;
    })
    .catch(() => undefined);
};
</script>

<style scoped>
.head { display: flex; justify-content: space-between; align-items: center; }
</style>

<template>
  <div v-loading="loading">
    <el-row :gutter="16" class="page-card">
      <el-col :span="6"><StatCard label="待处理预警" :value="data?.alerts.pending ?? '-'" /></el-col>
      <el-col :span="6"><StatCard label="高危预警" :value="data?.alerts.critical ?? '-'" color="#e64340" /></el-col>
      <el-col :span="6"><StatCard label="近24h 内容量" :value="data?.contents24h ?? '-'" /></el-col>
      <el-col :span="6">
        <StatCard
          label="采集健康"
          :value="data ? `${data.crawlHealth.ok} 正常 / ${data.crawlHealth.bad} 异常` : '-'"
          :hint="crawlerHint"
        />
      </el-col>
    </el-row>

    <el-row :gutter="16" class="page-card">
      <el-col :span="14">
        <el-card shadow="never">
          <template #header>订阅热度 Top5（情绪35% + 声量35% + 传播30%）</template>
          <EChart v-if="heatOption" :option="heatOption" height="300px" />
          <el-empty v-else description="暂无热度数据，先在订阅管理中添加订阅并等待采集" :image-size="60" />
        </el-card>
      </el-col>
      <el-col :span="10">
        <el-card shadow="never">
          <template #header>近24h 情绪分布</template>
          <EChart v-if="sentimentOption" :option="sentimentOption" height="300px" />
          <el-empty v-else :image-size="60" />
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="16">
      <el-col :span="12">
        <el-card shadow="never" class="page-card">
          <template #header>
            <div class="card-head">
              最新预测信号
              <el-button size="small" text type="primary" @click="$router.push('/signals')">全部 →</el-button>
            </div>
          </template>
          <el-table :data="data?.latestSignals ?? []" size="small" max-height="300">
            <el-table-column prop="date" label="日期" width="90" />
            <el-table-column prop="name" label="订阅" width="110" />
            <el-table-column label="信号" min-width="180">
              <template #default="{ row }">
                {{ (row.detail as any)?.headline ?? row.signalType }}
              </template>
            </el-table-column>
            <el-table-column label="方向" width="70">
              <template #default="{ row }"><SharedTags kind="direction" :text="row.direction" /></template>
            </el-table-column>
            <el-table-column prop="strength" label="强度" width="60" />
          </el-table>
        </el-card>
      </el-col>
      <el-col :span="12">
        <el-card shadow="never" class="page-card">
          <template #header>
            <div class="card-head">
              最新舆情内容
              <el-button size="small" text type="primary" @click="$router.push('/search')">全部 →</el-button>
            </div>
          </template>
          <el-table :data="data?.recentContents ?? []" size="small" max-height="300" @row-click="openContent">
            <el-table-column prop="publishedAt" label="时间" width="90">
              <template #default="{ row }">{{ formatTime(row.publishedAt) }}</template>
            </el-table-column>
            <el-table-column prop="title" label="标题" min-width="220" show-overflow-tooltip />
            <el-table-column prop="sourceName" label="来源" width="100" />
          </el-table>
        </el-card>
      </el-col>
    </el-row>

    <ContentDetailDrawer v-model="drawerVisible" :content="selected" :subscriptions="subscriptions" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import dayjs from 'dayjs';
import { dashboardApi, subscriptionsApi, type DashboardSummary } from '../api/client';
import type { ContentEntity, SubscriptionEntity } from '@fin/core';
import EChart from '../components/EChart.vue';
import StatCard from '../components/StatCard.vue';
import SharedTags from '../components/SharedTags.vue';
import ContentDetailDrawer from '../components/ContentDetailDrawer.vue';

const data = ref<DashboardSummary | null>(null);
const subscriptions = ref<SubscriptionEntity[]>([]);
const loading = ref(true);

const load = async () => {
  loading.value = true;
  try {
    data.value = await dashboardApi.summary();
    subscriptions.value = await subscriptionsApi.list();
  } finally {
    loading.value = false;
  }
};
onMounted(load);

const crawlerHint = computed(() => {
  if (!data.value) return '';
  const bad = data.value.crawlHealth.statuses.filter((s) => s.enabled && s.healthScore < 75);
  if (bad.length === 0) return '全部数据源正常';
  return `异常源：${bad.map((s) => s.sourceName).join('、')}`;
});

const formatTime = (t: string | Date) => dayjs(t).format('MM-DD HH:mm');

const heatOption = computed(() => {
  const top = data.value?.heatTop5 ?? [];
  if (top.length === 0) return null;
  return {
    grid: { left: 100, right: 30, top: 10, bottom: 24 },
    xAxis: { type: 'value', max: 100 },
    yAxis: { type: 'category', data: top.map((h) => `${h.name}(${h.code})`).reverse() },
    tooltip: {
      trigger: 'item',
      formatter: (p: { dataIndex: number }) => {
        const h = top.slice().reverse()[p.dataIndex];
        return `${h.name}：${h.score}（${h.level}）<br/>情绪 ${h.emotionScore} · 声量 ${h.volumeScore} · 传播 ${h.propagationScore}<br/>近24h 内容 ${h.contentCount} 条`;
      },
    },
    series: [
      {
        type: 'bar',
        data: top.map((h) => h.score).reverse(),
        barWidth: 16,
        itemStyle: { borderRadius: [0, 8, 8, 0] },
        label: { show: true, position: 'right' },
      },
    ],
  };
});

const sentimentOption = computed(() => {
  const s = data.value?.sentiment24h;
  if (!s) return null;
  return {
    tooltip: { trigger: 'item' },
    legend: { bottom: 0 },
    series: [
      {
        type: 'pie',
        radius: ['40%', '65%'],
        label: { show: false },
        data: [
          { name: '正面', value: s.positive, itemStyle: { color: '#e64340' } },
          { name: '中性', value: s.neutral, itemStyle: { color: '#909399' } },
          { name: '负面', value: s.negative, itemStyle: { color: '#2ba471' } },
        ],
      },
    ],
  };
});

const drawerVisible = ref(false);
const selected = ref<ContentEntity | null>(null);
const openContent = async (row: any) => {
  selected.value = row;
  drawerVisible.value = true;
};
</script>

<style scoped>
.card-head { display: flex; justify-content: space-between; align-items: center; }
</style>

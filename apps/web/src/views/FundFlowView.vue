<template>
  <div>
    <el-card shadow="never" class="page-card">
      <template #header>
        <div class="head">
          <div>
            <span>资金走向</span>
            <el-select v-model="selectedCode" size="small" style="width: 200px; margin-left: 12px" @change="loadFlow">
              <el-option v-for="s in rows" :key="s.subscription.id" :label="`${s.subscription.name}(${s.subscription.code})`" :value="s.subscription.code" />
            </el-select>
            <el-radio-group v-model="days" size="small" style="margin-left: 12px" @change="loadFlow">
              <el-radio-button :value="20">20日</el-radio-button>
              <el-radio-button :value="60">60日</el-radio-button>
              <el-radio-button :value="120">120日</el-radio-button>
            </el-radio-group>
          </div>
          <div class="muted">单位：亿元 · 红入绿出</div>
        </div>
      </template>

      <template v-if="flowRows.length">
        <div class="summary">
          <el-tag effect="plain">最新交易日：{{ flowRows[flowRows.length - 1].date }}</el-tag>
          <el-tag effect="plain" :type="flowRows[flowRows.length - 1].mainNetInflow >= 0 ? 'danger' : 'success'">
            当日主力净流入 {{ fmtYi(flowRows[flowRows.length - 1].mainNetInflow) }} 亿（{{ flowRows[flowRows.length - 1].mainNetPct.toFixed(2) }}%）
          </el-tag>
          <el-tag effect="plain">收盘价 {{ flowRows[flowRows.length - 1].closePrice ?? '—' }}（{{ flowRows[flowRows.length - 1].changePct?.toFixed(2) ?? '—' }}%）</el-tag>
        </div>
        <EChart :option="flowOption" height="380px" />
      </template>
      <el-empty v-else description="暂无资金流数据：添加订阅后自动回填 120 日历史" :image-size="70" />
    </el-card>

    <el-card shadow="never" class="page-card">
      <template #header>市场基准 · 上证指数主力资金</template>
      <EChart v-if="marketRows.length" :option="marketOption" height="220px" />
      <el-empty v-else description="等待收盘后自动采集" :image-size="60" />
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { fundflowApi } from '../api/client';
import type { FundFlowDailyEntity } from '@fin/core';
import EChart from '../components/EChart.vue';

interface SummaryRow {
  subscription: { id: string; code: string; name: string };
  latest: FundFlowDailyEntity | null;
  sumMain5: number;
}

const rows = ref<SummaryRow[]>([]);
const selectedCode = ref('');
const days = ref(60);
const flowRows = ref<FundFlowDailyEntity[]>([]);
const marketRows = ref<FundFlowDailyEntity[]>([]);

const load = async () => {
  rows.value = await fundflowApi.summary();
  if (!selectedCode.value && rows.value.length > 0) {
    // 优先默认选中有资金流数据的订阅，避免打开页面就是空图表
    selectedCode.value = (rows.value.find((r) => r.rowsCount > 0) ?? rows.value[0]).subscription.code;
  }
  if (selectedCode.value) await loadFlow();
  marketRows.value = await fundflowApi.market(30).catch(() => []);
};

const loadFlow = async () => {
  if (!selectedCode.value) return;
  flowRows.value = await fundflowApi.flow(selectedCode.value, days.value).catch(() => []);
};

onMounted(load);

const fmtYi = (v: number) => (v / 1e8).toFixed(2);

const flowOption = computed(() => {
  const r = flowRows.value;
  if (r.length === 0) return {};
  const dates = r.map((x) => x.date.slice(5));
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: { bottom: 0, data: ['超大单', '大单', '中单', '小单', '收盘价'] },
    grid: [{ left: 60, right: 60, top: 20, bottom: 60 }],
    xAxis: { type: 'category', data: dates },
    yAxis: [
      { type: 'value', name: '亿元', axisLabel: { formatter: (v: number) => (v / 1e8).toFixed(0) } },
      { type: 'value', name: '收盘价', axisLabel: { formatter: (v: number) => v.toFixed(0) } },
    ],
    series: [
      { name: '超大单', type: 'bar', stack: 'flow', data: r.map((x) => x.superLargeNetInflow), itemStyle: { color: '#c23531' } },
      { name: '大单', type: 'bar', stack: 'flow', data: r.map((x) => x.largeNetInflow), itemStyle: { color: '#e64340' } },
      { name: '中单', type: 'bar', stack: 'flow', data: r.map((x) => x.mediumNetInflow), itemStyle: { color: '#8d98b3' } },
      { name: '小单', type: 'bar', stack: 'flow', data: r.map((x) => x.smallNetInflow), itemStyle: { color: '#2ba471' } },
      {
        name: '收盘价',
        type: 'line',
        yAxisIndex: 1,
        data: r.map((x) => x.closePrice),
        smooth: true,
        showSymbol: false,
        lineStyle: { width: 2, color: '#2563eb' },
      },
    ],
  };
});

const marketOption = computed(() => {
  const r = marketRows.value;
  if (r.length === 0) return {};
  return {
    tooltip: { trigger: 'axis' },
    grid: { left: 60, right: 20, top: 20, bottom: 40 },
    xAxis: { type: 'category', data: r.map((x) => x.date.slice(5)) },
    yAxis: { type: 'value', name: '亿元', axisLabel: { formatter: (v: number) => (v / 1e8).toFixed(0) } },
    series: [
      {
        name: '上证主力净流入',
        type: 'bar',
        data: r.map((x) => ({
          value: x.mainNetInflow,
          itemStyle: { color: x.mainNetInflow >= 0 ? '#e64340' : '#2ba471' },
        })),
        barWidth: '55%',
      },
    ],
  };
});
</script>

<style scoped>
.head { display: flex; justify-content: space-between; align-items: center; }
.summary { display: flex; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
</style>

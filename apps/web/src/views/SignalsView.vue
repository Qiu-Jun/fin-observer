<template>
  <div>
    <el-alert type="warning" :closable="false" class="page-card" show-icon>
      <b>统计模型辅助信号，不构成投资建议。</b>
      趋势研判基于主力资金占比的加权均线与线性回归外推（R² 作置信度），规则信号基于资金流形态与舆情共振。
    </el-alert>

    <el-card shadow="never" class="page-card">
      <template #header>
        <div class="head">
          <span>趋势研判（每个订阅最新一条 trend_forecast）</span>
          <div>
            <el-button size="small" @click="computeNow" :loading="computing">立即重算</el-button>
            <el-button size="small" @click="load">刷新</el-button>
          </div>
        </div>
      </template>
      <el-row :gutter="12">
        <el-col v-for="t in trendCards" :key="t.subscriptionId" :span="6" style="margin-bottom: 12px">
          <el-card shadow="never" :class="['trend-card', t.direction]">
            <div class="trend-name">{{ t.name }} <span class="muted">{{ t.date }}</span></div>
            <div class="trend-value" :class="t.direction">{{ t.trend }}</div>
            <div class="muted">置信强度 {{ t.strength }} · R²={{ t.r2 }}</div>
            <div class="muted">{{ t.next }}</div>
          </el-card>
        </el-col>
      </el-row>
      <el-empty v-if="trendCards.length === 0" description="暂无趋势数据：需先有资金流历史（添加订阅后自动回填），再点「立即重算」" :image-size="60" />
    </el-card>

    <el-card shadow="never">
      <template #header>
        <div class="head">
          <span>规则信号列表（近 14 天）</span>
          <el-radio-group v-model="direction" size="small" @change="load">
            <el-radio-button value="">全部</el-radio-button>
            <el-radio-button value="bullish">看多</el-radio-button>
            <el-radio-button value="bearish">看空</el-radio-button>
          </el-radio-group>
        </div>
      </template>
      <el-table :data="signals" v-loading="loading" max-height="480">
        <el-table-column prop="date" label="日期" width="100" />
        <el-table-column prop="name" label="订阅" width="130" />
        <el-table-column label="信号" min-width="300">
          <template #default="{ row }">{{ (row.detail as any)?.headline ?? row.signalType }}</template>
        </el-table-column>
        <el-table-column label="方向" width="80">
          <template #default="{ row }"><SharedTags kind="direction" :text="row.direction" /></template>
        </el-table-column>
        <el-table-column prop="strength" label="强度" width="70" />
        <el-table-column label="说明" min-width="320">
          <template #default="{ row }">
            <span class="muted">{{ (row.detail as any)?.description }}</span>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { crawlersApi, signalsApi, subscriptionsApi } from '../api/client';
import type { FundFlowSignalEntity, SubscriptionEntity } from '@fin/core';
import SharedTags from '../components/SharedTags.vue';

const signals = ref<FundFlowSignalEntity[]>([]);
const subs = ref<SubscriptionEntity[]>([]);
const direction = ref('');
const loading = ref(false);
const computing = ref(false);

const load = async () => {
  loading.value = true;
  try {
    [signals.value, subs.value] = await Promise.all([
      signalsApi.list({ direction: direction.value || undefined, days: 14, limit: 200 }),
      subscriptionsApi.list(),
    ]);
  } finally {
    loading.value = false;
  }
};

const computeNow = async () => {
  computing.value = true;
  try {
    const r = await crawlersApi.computeSignals();
    ElMessage[r.ok ? 'success' : 'warning'](r.message);
    await load();
  } catch (err) {
    ElMessage.error((err as Error).message);
  } finally {
    computing.value = false;
  }
};

onMounted(load);

const TREND_NAMES: Record<string, string> = {
  流入加速: '流入加速', 流入衰减: '流入衰减', 流出加速: '流出加速', 流出企稳: '流出企稳', 横盘震荡: '横盘震荡',
};

const trendCards = computed(() => {
  const bySub = new Map<string, FundFlowSignalEntity>();
  for (const s of signals.value) {
    if (s.signalType !== 'trend_forecast') continue;
    if (!bySub.has(s.subscriptionId)) bySub.set(s.subscriptionId, s);
  }
  return [...bySub.values()].map((s) => {
    const metrics = (s.detail as any)?.metrics ?? {};
    const name = subs.value.find((x) => x.id === s.subscriptionId)?.name ?? s.name;
    return {
      subscriptionId: s.subscriptionId,
      name: `${name}(${s.code})`,
      date: s.date,
      trend: TREND_NAMES[metrics.trend] ?? metrics.trend ?? '—',
      direction: s.direction,
      strength: s.strength,
      r2: metrics.r2 ?? '—',
      next: (s.detail as any)?.description ?? '',
    };
  });
});
</script>

<style scoped>
.head { display: flex; justify-content: space-between; align-items: center; }
.trend-card.bullish { border-left: 3px solid #e64340; }
.trend-card.bearish { border-left: 3px solid #2ba471; }
.trend-card.neutral { border-left: 3px solid #909399; }
.trend-name { font-weight: 600; margin-bottom: 6px; }
.trend-value { font-size: 20px; font-weight: 700; margin-bottom: 4px; }
</style>

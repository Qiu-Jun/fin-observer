<template>
  <div>
    <el-card shadow="never" class="page-card">
      <el-form inline @submit.prevent>
        <el-form-item label="关键词">
          <el-input v-model="filters.q" placeholder="标题 / 正文" clearable style="width: 200px" @keyup.enter="load" />
        </el-form-item>
        <el-form-item label="订阅">
          <el-select v-model="filters.subscriptionId" placeholder="全部订阅" clearable style="width: 160px">
            <el-option v-for="s in subscriptions" :key="s.id" :label="`${s.name}(${s.code})`" :value="s.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="情绪">
          <el-select v-model="filters.sentiment" placeholder="全部" clearable style="width: 110px">
            <el-option label="正面" value="positive" />
            <el-option label="中性" value="neutral" />
            <el-option label="负面" value="negative" />
          </el-select>
        </el-form-item>
        <el-form-item label="风险">
          <el-select v-model="filters.riskLevel" placeholder="全部" clearable style="width: 110px">
            <el-option label="低" value="low" />
            <el-option label="中" value="medium" />
            <el-option label="高" value="high" />
            <el-option label="极高" value="critical" />
          </el-select>
        </el-form-item>
        <el-form-item label="来源">
          <el-select v-model="filters.sourceType" placeholder="全部" clearable style="width: 110px">
            <el-option label="新闻" value="news" />
            <el-option label="社媒" value="social" />
            <el-option label="论坛" value="forum" />
            <el-option label="研报" value="research" />
          </el-select>
        </el-form-item>
        <el-form-item label="日期">
          <el-date-picker v-model="dateRange" type="daterange" value-format="YYYY-MM-DD" start-placeholder="开始" end-placeholder="结束" style="width: 240px" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="load">检索</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card shadow="never">
      <el-table :data="result.items" v-loading="loading" @row-click="openDetail" max-height="640">
        <el-table-column prop="publishedAt" label="时间" width="100">
          <template #default="{ row }">{{ formatTime(row.publishedAt) }}</template>
        </el-table-column>
        <el-table-column prop="title" label="标题" min-width="320" show-overflow-tooltip />
        <el-table-column prop="sourceName" label="来源" width="110" />
        <el-table-column label="情绪" width="90">
          <template #default="{ row }">
            <SharedTags kind="sentiment" :text="row.nlp?.enhanced?.label ?? row.nlp?.sentimentLabel ?? 'neutral'" />
          </template>
        </el-table-column>
        <el-table-column label="风险" width="70">
          <template #default="{ row }"><SharedTags kind="risk" :text="row.nlp?.riskLevel ?? 'low'" /></template>
        </el-table-column>
        <el-table-column label="命中" width="80">
          <template #default="{ row }">
            <el-tag v-if="(row.matches ?? []).length" size="small" type="primary" effect="plain">
              {{ (row.matches ?? []).length }} 个
            </el-tag>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
      </el-table>
      <el-pagination
        v-model:current-page="page"
        :page-size="pageSize"
        :total="result.total"
        layout="total, prev, pager, next"
        style="margin-top: 12px; justify-content: flex-end"
        @current-change="load"
      />
    </el-card>

    <ContentDetailDrawer v-model="drawerVisible" :content="selected" :subscriptions="subscriptions" />
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import dayjs from 'dayjs';
import { contentsApi, subscriptionsApi, type ContentsSearchResult } from '../api/client';
import type { ContentEntity, SubscriptionEntity } from '@fin/core';
import SharedTags from '../components/SharedTags.vue';
import ContentDetailDrawer from '../components/ContentDetailDrawer.vue';

const filters = reactive<{ q: string; subscriptionId: string; sentiment: string; riskLevel: string; sourceType: string }>({
  q: '',
  subscriptionId: '',
  sentiment: '',
  riskLevel: '',
  sourceType: '',
});
const dateRange = ref<[string, string] | null>(null);
const page = ref(1);
const pageSize = 20;
const result = ref<ContentsSearchResult>({ items: [], total: 0, page: 1, pageSize });
const subscriptions = ref<SubscriptionEntity[]>([]);
const loading = ref(false);

const load = async () => {
  loading.value = true;
  try {
    result.value = await contentsApi.search({
      q: filters.q || undefined,
      subscriptionId: filters.subscriptionId || undefined,
      sentiment: filters.sentiment || undefined,
      riskLevel: filters.riskLevel || undefined,
      sourceType: filters.sourceType || undefined,
      dateFrom: dateRange.value?.[0] ? `${dateRange.value[0]}T00:00:00+08:00` : undefined,
      dateTo: dateRange.value?.[1] ? `${dateRange.value[1]}T23:59:59+08:00` : undefined,
      page: page.value,
      pageSize,
    });
  } finally {
    loading.value = false;
  }
};

onMounted(async () => {
  subscriptions.value = await subscriptionsApi.list();
  await load();
});

const formatTime = (t: string | Date) => dayjs(t).format('MM-DD HH:mm');

const drawerVisible = ref(false);
const selected = ref<ContentEntity | null>(null);
const openDetail = (row: any) => {
  selected.value = row;
  drawerVisible.value = true;
};
</script>

<template>
  <div>
    <el-card shadow="never" class="page-card">
      <template #header>
        <div class="head">
          <span>订阅列表（股票 / ETF）</span>
          <div>
            <el-button size="small" @click="load">刷新</el-button>
            <el-button size="small" type="primary" @click="openCreate">添加订阅</el-button>
          </div>
        </div>
      </template>

      <el-table :data="rows" v-loading="loading">
        <el-table-column prop="code" label="代码" width="90" />
        <el-table-column prop="name" label="名称" width="140" />
        <el-table-column prop="type" label="类型" width="80">
          <template #default="{ row }">
            <el-tag size="small" :type="row.type === 'etf' ? 'warning' : 'primary'" effect="plain">
              {{ row.type === 'etf' ? 'ETF' : '股票' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="最新资金流" width="170">
          <template #default="{ row }">
            <template v-if="flowMap[row.id]?.latest">
              <span :class="flowMap[row.id].latest.mainNetInflow >= 0 ? 'trend-bullish' : 'trend-bearish'">
                主力 {{ fmtYi(flowMap[row.id].latest.mainNetInflow) }} 亿
              </span>
              <div class="muted">5日累计 {{ fmtYi(flowMap[row.id].sumMain5) }} 亿</div>
            </template>
            <span v-else class="muted">暂无数据</span>
          </template>
        </el-table-column>
        <el-table-column prop="aliases" label="别名（关键字）" min-width="150">
          <template #default="{ row }">{{ (row.aliases ?? []).join('、') || '—' }}</template>
        </el-table-column>
        <el-table-column prop="enabled" label="启用" width="80">
          <template #default="{ row }">
            <el-switch :model-value="row.enabled" size="small" @change="(v: any) => toggle(row, v)" />
          </template>
        </el-table-column>
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button size="small" text type="primary" @click="openEdit(row)">编辑</el-button>
            <el-button size="small" text type="danger" @click="remove(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="muted" style="margin-top: 8px">
        添加订阅后自动回填 120 日资金流，并触发一轮按关键词的定向采集；此后按交易日 15:10 自动更新。
      </div>
    </el-card>

    <el-dialog v-model="dialogVisible" :title="editing ? '编辑订阅' : '添加订阅'" width="480px">
      <el-form :model="form" label-width="90px">
        <el-form-item label="类型">
          <el-radio-group v-model="form.type" :disabled="!!editing">
            <el-radio-button value="stock">股票</el-radio-button>
            <el-radio-button value="etf">ETF</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="代码">
          <el-input v-model="form.code" placeholder="6 位数字，如 600519 / 510300" :disabled="!!editing" maxlength="6" />
        </el-form-item>
        <el-form-item label="名称">
          <el-input v-model="form.name" placeholder="如 贵州茅台 / 沪深300ETF" />
        </el-form-item>
        <el-form-item label="别名">
          <el-input v-model="form.aliases" placeholder="逗号分隔，如 茅台, Moutai" />
          <div class="muted">别名用于关键字爬虫与相关度匹配，建议包含常用简称</div>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.notes" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { fundflowApi, subscriptionsApi } from '../api/client';
import type { SubscriptionEntity } from '@fin/core';

const rows = ref<SubscriptionEntity[]>([]);
const loading = ref(false);
const saving = ref(false);
const dialogVisible = ref(false);
const editing = ref<SubscriptionEntity | null>(null);
const flowMap = ref<Record<string, { latest: { mainNetInflow: number }; sumMain5: number }>>({});

const form = reactive<{ type: 'stock' | 'etf'; code: string; name: string; aliases: string; notes: string }>({
  type: 'stock',
  code: '',
  name: '',
  aliases: '',
  notes: '',
});

const load = async () => {
  loading.value = true;
  try {
    rows.value = await subscriptionsApi.list();
    const summary = await fundflowApi.summary();
    const map: typeof flowMap.value = {};
    for (const s of summary) map[s.subscription.id] = { latest: s.latest as any, sumMain5: s.sumMain5 };
    flowMap.value = map;
  } catch (err) {
    ElMessage.error((err as Error).message);
  } finally {
    loading.value = false;
  }
};
onMounted(load);

const fmtYi = (v: number) => (v / 1e8).toFixed(2);

const openCreate = () => {
  editing.value = null;
  Object.assign(form, { type: 'stock', code: '', name: '', aliases: '', notes: '' });
  dialogVisible.value = true;
};

const openEdit = (row: any) => {
  editing.value = row;
  Object.assign(form, {
    type: row.type,
    code: row.code,
    name: row.name,
    aliases: (row.aliases ?? []).join(', '),
    notes: row.notes ?? '',
  });
  dialogVisible.value = true;
};

const save = async () => {
  if (!/^\d{6}$/.test(form.code)) {
    ElMessage.warning('代码必须为 6 位数字');
    return;
  }
  if (!form.name.trim()) {
    ElMessage.warning('请填写名称');
    return;
  }
  saving.value = true;
  try {
    const payload = {
      type: form.type,
      code: form.code,
      name: form.name,
      aliases: form.aliases,
      notes: form.notes,
    };
    if (editing.value) await subscriptionsApi.update(editing.value.id, payload);
    else await subscriptionsApi.create(payload);
    ElMessage.success(editing.value ? '已保存（已通知爬虫服务刷新关键词）' : '已添加（正在回填资金流并定向采集）');
    dialogVisible.value = false;
    await load();
  } catch (err) {
    ElMessage.error((err as Error).message);
  } finally {
    saving.value = false;
  }
};

const toggle = async (row: any, enabled: boolean | number | string) => {
  try {
    await subscriptionsApi.update(row.id, { enabled: Boolean(enabled) });
    await load();
  } catch (err) {
    ElMessage.error((err as Error).message);
  }
};

const remove = async (row: any) => {
  await ElMessageBox.confirm(`确认删除订阅「${row.name}」？历史内容与资金流数据将保留。`, '删除确认', { type: 'warning' });
  try {
    await subscriptionsApi.remove(row.id);
    ElMessage.success('已删除');
    await load();
  } catch (err) {
    ElMessage.error((err as Error).message);
  }
};
</script>

<style scoped>
.head { display: flex; justify-content: space-between; align-items: center; }
</style>

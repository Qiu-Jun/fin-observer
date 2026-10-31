<template>
  <div>
    <el-tabs v-model="tab" class="page-card">
      <el-tab-pane label="预警列表" name="list">
        <div class="toolbar">
          <el-select v-model="filters.status" placeholder="状态" clearable size="small" style="width: 130px" @change="load">
            <el-option label="待处理" value="pending" />
            <el-option label="处理中" value="processing" />
            <el-option label="已解决" value="resolved" />
            <el-option label="已忽略" value="ignored" />
          </el-select>
          <el-select v-model="filters.riskLevel" placeholder="风险" clearable size="small" style="width: 120px" @change="load">
            <el-option label="极高" value="critical" />
            <el-option label="高" value="high" />
            <el-option label="中" value="medium" />
            <el-option label="低" value="low" />
          </el-select>
          <el-button size="small" type="primary" @click="evaluateNow" :loading="evaluating">立即评估</el-button>
        </div>

        <el-table :data="alerts" v-loading="loading" max-height="560">
          <el-table-column prop="triggeredAt" label="触发时间" width="110">
            <template #default="{ row }">{{ formatTime(row.triggeredAt) }}</template>
          </el-table-column>
          <el-table-column prop="title" label="标题" min-width="260" show-overflow-tooltip />
          <el-table-column prop="description" label="描述" min-width="300" show-overflow-tooltip />
          <el-table-column label="风险" width="70">
            <template #default="{ row }"><SharedTags kind="risk" :text="row.riskLevel" /></template>
          </el-table-column>
          <el-table-column prop="status" label="状态" width="90">
            <template #default="{ row }">
              <el-tag size="small" :type="statusType(row.status)" effect="plain">{{ statusText(row.status) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="170" fixed="right">
            <template #default="{ row }">
              <el-button size="small" text type="primary" @click="handle(row, 'start_processing')">处理</el-button>
              <el-button size="small" text type="success" @click="handle(row, 'resolve')">解决</el-button>
              <el-button size="small" text @click="handle(row, 'ignore')">忽略</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="预警规则" name="rules">
        <div class="toolbar">
          <el-button size="small" type="primary" @click="openRuleDialog">新建规则</el-button>
        </div>
        <el-table :data="rules" v-loading="loading">
          <el-table-column prop="name" label="规则名" min-width="180" />
          <el-table-column label="条件" min-width="320">
            <template #default="{ row }">
              <span class="muted">{{ condSummary(row.conditions) }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="riskLevel" label="风险定级" width="90" />
          <el-table-column prop="enabled" label="启用" width="80">
            <template #default="{ row }">
              <el-switch :model-value="row.enabled" size="small" @change="(v: any) => toggleRule(row, v)" />
            </template>
          </el-table-column>
          <el-table-column label="操作" width="90" fixed="right">
            <template #default="{ row }">
              <el-button size="small" text type="danger" @click="removeRule(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>
    </el-tabs>

    <el-dialog v-model="ruleDialog" title="新建预警规则" width="520px">
      <el-form :model="ruleForm" label-width="110px">
        <el-form-item label="规则名">
          <el-input v-model="ruleForm.name" />
        </el-form-item>
        <el-form-item label="触发关键词">
          <el-input v-model="ruleForm.keywords" placeholder="逗号分隔，可留空" />
        </el-form-item>
        <el-form-item label="时间窗（分钟）">
          <el-input-number v-model="ruleForm.windowMinutes" :min="30" :step="30" />
        </el-form-item>
        <el-form-item label="资金信号方向">
          <el-select v-model="ruleForm.signalDirection" clearable placeholder="可留空">
            <el-option label="看空信号" value="bearish" />
            <el-option label="看多信号" value="bullish" />
          </el-select>
        </el-form-item>
        <el-form-item label="风险定级">
          <el-select v-model="ruleForm.riskLevel">
            <el-option label="中" value="medium" />
            <el-option label="高" value="high" />
            <el-option label="极高" value="critical" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="ruleDialog = false">取消</el-button>
        <el-button type="primary" @click="saveRule">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import dayjs from 'dayjs';
import { ElMessage, ElMessageBox } from 'element-plus';
import { alertRulesApi, alertsApi, type AlertRuleInput } from '../api/client';
import type { AlertEntity, AlertRuleEntity } from '@fin/core';
import SharedTags from '../components/SharedTags.vue';

const tab = ref('list');
const alerts = ref<AlertEntity[]>([]);
const rules = ref<AlertRuleEntity[]>([]);
const loading = ref(false);
const evaluating = ref(false);
const filters = reactive<{ status: string; riskLevel: string }>({ status: '', riskLevel: '' });

const load = async () => {
  loading.value = true;
  try {
    alerts.value = await alertsApi.list({
      status: filters.status || undefined,
      riskLevel: filters.riskLevel || undefined,
      limit: 200,
    });
    rules.value = await alertRulesApi.list();
  } finally {
    loading.value = false;
  }
};
onMounted(load);

const formatTime = (t: string | Date) => dayjs(t).format('MM-DD HH:mm');

const statusText = (s: string) => ({ pending: '待处理', processing: '处理中', resolved: '已解决', ignored: '已忽略' })[s] ?? s;
const statusType = (s: string): 'danger' | 'warning' | 'success' | 'info' =>
  (({ pending: 'danger', processing: 'warning', resolved: 'success', ignored: 'info' }) as Record<string, 'danger' | 'warning' | 'success' | 'info'>)[s] ?? 'info';

const handle = async (row: any, action: string) => {
  try {
    await alertsApi.handle(row.id, action);
    await load();
  } catch (err) {
    ElMessage.error((err as Error).message);
  }
};

const evaluateNow = async () => {
  evaluating.value = true;
  try {
    const r = await alertsApi.evaluate();
    ElMessage.success(`评估完成，新增 ${r.created} 条预警`);
    await load();
  } finally {
    evaluating.value = false;
  }
};

const condSummary = (c: Record<string, unknown>) => {
  const parts: string[] = [];
  if (c.keywords) parts.push(`关键词: ${(c.keywords as string[]).join('、')}`);
  if (c.riskLevelAbove) parts.push(`风险≥${c.riskLevelAbove}`);
  if (c.signalDirection) parts.push(`资金信号-${c.signalDirection}`);
  if (c.negativeVolumeRiseAbove) parts.push(`负面声量增${c.negativeVolumeRiseAbove}%`);
  parts.push(`窗口${c.windowMinutes ?? 120}分钟`);
  return parts.join(' · ');
};

const ruleDialog = ref(false);
const ruleForm = reactive<{ name: string; keywords: string; windowMinutes: number; signalDirection: string; riskLevel: string }>({
  name: '',
  keywords: '',
  windowMinutes: 240,
  signalDirection: '',
  riskLevel: 'medium',
});

const openRuleDialog = () => {
  Object.assign(ruleForm, { name: '', keywords: '', windowMinutes: 240, signalDirection: '', riskLevel: 'medium' });
  ruleDialog.value = true;
};

const saveRule = async () => {
  if (!ruleForm.name.trim()) {
    ElMessage.warning('请填写规则名');
    return;
  }
  const conditions: Record<string, unknown> = { windowMinutes: ruleForm.windowMinutes };
  if (ruleForm.keywords) conditions.keywords = ruleForm.keywords.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
  if (ruleForm.signalDirection) conditions.signalDirection = ruleForm.signalDirection;
  const payload: AlertRuleInput = { name: ruleForm.name, conditions, riskLevel: ruleForm.riskLevel, enabled: true };
  try {
    await alertRulesApi.create(payload);
    ElMessage.success('规则已创建');
    ruleDialog.value = false;
    await load();
  } catch (err) {
    ElMessage.error((err as Error).message);
  }
};

const toggleRule = async (row: any, enabled: boolean | number | string) => {
  try {
    await alertRulesApi.update(row.id, { enabled: Boolean(enabled) });
    await load();
  } catch (err) {
    ElMessage.error((err as Error).message);
  }
};

const removeRule = async (row: any) => {
  await ElMessageBox.confirm(`确认删除规则「${row.name}」？`, '删除确认', { type: 'warning' });
  await alertRulesApi.remove(row.id);
  await load();
};
</script>

<style scoped>
.toolbar { display: flex; gap: 8px; margin-bottom: 12px; }
</style>

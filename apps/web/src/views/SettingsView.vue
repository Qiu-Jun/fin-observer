<template>
  <div>
    <el-card shadow="never" class="page-card">
      <template #header>
        <div class="head">
          <span>爬虫管理（实时状态经 gRPC 读取自 crawler 服务）</span>
          <div>
            <el-button size="small" type="primary" :loading="runningAll" @click="runAll">全部采集</el-button>
            <el-button size="small" @click="load">刷新</el-button>
          </div>
        </div>
      </template>
      <el-table :data="statuses" v-loading="loading">
        <el-table-column prop="sourceName" label="数据源" width="110" />
        <el-table-column prop="sourceType" label="类型" width="80" />
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag size="small" :type="row.isRunning ? 'primary' : row.circuitOpen ? 'danger' : row.enabled ? 'success' : 'info'" effect="light">
              {{ row.circuitOpen ? '熔断中' : row.isRunning ? '运行中' : row.enabled ? '空闲' : '停用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="健康分" width="90">
          <template #default="{ row }">
            <span :style="{ color: row.healthScore >= 75 ? '#2ba471' : '#e64340' }">{{ row.healthScore }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="totalFetched" label="累计抓取" width="90" />
        <el-table-column prop="consecutiveFailures" label="连续失败" width="90" />
        <el-table-column label="上次成功" min-width="140">
          <template #default="{ row }">{{ row.lastCrawlAt ? formatTime(row.lastCrawlAt) : '—' }}</template>
        </el-table-column>
        <el-table-column label="操作" width="100" fixed="right">
          <template #default="{ row }">
            <el-button size="small" text type="primary" :loading="row.isRunning" @click="runOne(row.name)">单跑</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-card shadow="never" class="page-card">
      <template #header>LLM 增强配置（OpenAI 兼容接口）</template>
      <p class="muted">
        编辑 <code>apps/crawler/.env</code> 后重启 crawler 服务生效：
      </p>
      <pre class="code">PRIMARY_LLM_API_KEY=sk-xxxx          # 必填才启用 LLM
PRIMARY_LLM_BASE_URL=https://api.deepseek.com/v1   # DeepSeek / 智谱 / 通义 / Kimi 等均可
PRIMARY_LLM_MODEL=deepseek-chat</pre>
      <p class="muted">
        留空 key 时自动降级为纯词典模型（零成本、可离线）。当前 LLM 只对「命中订阅」的内容调用（成本漏斗）。
      </p>
    </el-card>

    <el-card shadow="never" class="page-card">
      <template #header>最近采集日志（共享库读取）</template>
      <el-table :data="logs" size="small" max-height="320">
        <el-table-column prop="crawledAt" label="时间" width="160">
          <template #default="{ row }">{{ formatTime(row.crawledAt) }}</template>
        </el-table-column>
        <el-table-column prop="source" label="来源" width="130" />
        <el-table-column prop="itemsFetched" label="抓取" width="70" />
        <el-table-column prop="itemsAdded" label="入库" width="70" />
        <el-table-column prop="duration" label="耗时ms" width="80" />
        <el-table-column prop="error" label="错误" min-width="220" show-overflow-tooltip />
      </el-table>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import dayjs from 'dayjs';
import { ElMessage } from 'element-plus';
import { crawlersApi, type CrawlLog, type CrawlerStatus } from '../api/client';

const statuses = ref<CrawlerStatus[]>([]);
const logs = ref<CrawlLog[]>([]);
const loading = ref(false);
const runningAll = ref(false);

const load = async () => {
  loading.value = true;
  try {
    statuses.value = await crawlersApi.status().catch(() => []);
    logs.value = await crawlersApi.logs();
  } finally {
    loading.value = false;
  }
};
onMounted(load);

const formatTime = (t: string | Date) => dayjs(t).format('MM-DD HH:mm:ss');

const runAll = async () => {
  runningAll.value = true;
  try {
    const r = await crawlersApi.runAll();
    ElMessage.success(`触发完成：${(r.results ?? []).length} 个源`);
    await load();
  } catch (err) {
    ElMessage.error((err as Error).message);
  } finally {
    runningAll.value = false;
  }
};

const runOne = async (name: string) => {
  try {
    const r = await crawlersApi.run(name);
    ElMessage[r.success ? 'success' : 'warning'](`${name}: fetched ${r.fetched}, added ${r.added}${r.error ? `（${r.error}）` : ''}`);
    await load();
  } catch (err) {
    ElMessage.error((err as Error).message);
  }
};
</script>

<style scoped>
.head { display: flex; justify-content: space-between; align-items: center; }
.code { background: var(--el-fill-color-light); padding: 10px 14px; border-radius: 6px; font-size: 12px; }
</style>

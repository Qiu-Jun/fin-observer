import axios from 'axios';
import type {
  AlertEntity,
  AlertRuleEntity,
  ContentEntity,
  FundFlowDailyEntity,
  FundFlowSignalEntity,
  SubscriptionEntity,
  SubscriptionHeat,
} from '@fin/core';

export const http = axios.create({ baseURL: '/api/v1', timeout: 30000 });

http.interceptors.response.use(
  (resp) => resp.data,
  (err) => Promise.reject(new Error(err?.response?.data?.message ?? err?.message ?? '请求失败')),
);

// ── dashboard ────────────────────────────────────────────────────────────────

export interface DashboardSummary {
  alerts: { pending: number; critical: number };
  contents24h: number;
  sentiment24h: { positive: number; neutral: number; negative: number };
  heatTop5: SubscriptionHeat[];
  latestSignals: FundFlowSignalEntity[];
  recentContents: ContentEntity[];
  crawlHealth: {
    ok: number;
    bad: number;
    statuses: CrawlerStatus[];
  };
}

export interface CrawlerStatus {
  name: string;
  sourceName: string;
  sourceType: string;
  enabled: boolean;
  isRunning: boolean;
  lastSuccess: boolean;
  lastError: string;
  lastCrawlAt: string;
  totalFetched: number;
  consecutiveFailures: number;
  circuitOpen: boolean;
  healthScore: number;
}

export const dashboardApi = {
  summary: () => http.get<unknown, DashboardSummary>('/dashboard/summary'),
};

// ── subscriptions ────────────────────────────────────────────────────────────

export interface SubscriptionInput {
  type: 'stock' | 'etf';
  code: string;
  name: string;
  aliases?: string;
  notes?: string;
  enabled?: boolean;
}

export const subscriptionsApi = {
  list: () => http.get<unknown, SubscriptionEntity[]>('/subscriptions'),
  create: (data: SubscriptionInput) => http.post<unknown, SubscriptionEntity>('/subscriptions', data),
  update: (id: string, data: Partial<SubscriptionInput>) => http.put<unknown, SubscriptionEntity>(`/subscriptions/${id}`, data),
  remove: (id: string) => http.delete<unknown, { ok: boolean }>(`/subscriptions/${id}`),
};

// ── contents ─────────────────────────────────────────────────────────────────

export interface ContentsSearchResult {
  items: ContentEntity[];
  total: number;
  page: number;
  pageSize: number;
}

export const contentsApi = {
  search: (params: Record<string, unknown>) => http.get<unknown, ContentsSearchResult>('/contents', { params }),
  get: (id: string) => http.get<unknown, ContentEntity>(`/contents/${id}`),
  stats: (days = 7) => http.get<unknown, { total: number; days: number; sentiment: Record<string, number>; risk: Record<string, number>; bySource: Record<string, number> }>('/contents/stats', { params: { days } }),
  eventDistribution: (days = 7) =>
    http.get<unknown, { totalEvents: number; byType: Record<string, number>; byDirection: Record<string, number> }>(
      '/contents/events/distribution',
      { params: { days } },
    ),
  eventTimeline: (params: { days?: number; limit?: number; type?: string }) =>
    http.get<unknown, Array<{ contentId: string; title: string; sourceName: string; publishedAt: string; event: { type: string; impactDirection: string; confidence: number; triggers: string[]; subjects: string[]; summary: string } }>>(
      '/contents/events/timeline',
      { params },
    ),
  reanalyze: (id: string) => http.post<unknown, ContentEntity>(`/contents/${id}/reanalyze`),
};

// ── fundflow & signals ───────────────────────────────────────────────────────

export const fundflowApi = {
  summary: () =>
    http.get<unknown, Array<{ subscription: SubscriptionEntity; latest: FundFlowDailyEntity | null; sumMain5: number; rowsCount: number }>>(
      '/fundflow/summary',
    ),
  flow: (code: string, days = 60) => http.get<unknown, FundFlowDailyEntity[]>(`/fundflow/${code}`, { params: { days } }),
  market: (days = 30) => http.get<unknown, FundFlowDailyEntity[]>('/fundflow/market', { params: { days } }),
};

export const signalsApi = {
  list: (params: { subscriptionId?: string; direction?: string; days?: number; limit?: number }) =>
    http.get<unknown, FundFlowSignalEntity[]>('/signals', { params }),
};

export const temperaturesApi = {
  list: () => http.get<unknown, SubscriptionHeat[]>('/temperatures'),
};

// ── alerts ───────────────────────────────────────────────────────────────────

export const alertsApi = {
  list: (params: { status?: string; riskLevel?: string; limit?: number }) =>
    http.get<unknown, AlertEntity[]>('/alerts', { params }),
  handle: (id: string, action: string, note?: string) =>
    http.post<unknown, AlertEntity>(`/alerts/${id}/handle`, { action, note }),
  evaluate: () => http.post<unknown, { created: number }>('/alerts/evaluate'),
};

export interface AlertRuleInput {
  name: string;
  conditions: Record<string, unknown>;
  riskLevel?: string;
  enabled?: boolean;
}

export const alertRulesApi = {
  list: () => http.get<unknown, AlertRuleEntity[]>('/alert-rules'),
  create: (data: AlertRuleInput) => http.post<unknown, AlertRuleEntity>('/alert-rules', data),
  update: (id: string, data: Partial<AlertRuleInput>) => http.put<unknown, AlertRuleEntity>(`/alert-rules/${id}`, data),
  remove: (id: string) => http.delete<unknown, { ok: boolean }>(`/alert-rules/${id}`),
};

// ── crawlers ─────────────────────────────────────────────────────────────────

export interface CrawlResultSummary {
  source: string;
  fetched: number;
  added: number;
  success: boolean;
  error: string;
}

export interface CrawlLog {
  id: string;
  source: string;
  crawledAt: string;
  itemsFetched: number;
  itemsAdded: number;
  success: boolean;
  duration: number;
  error: string | null;
}

export const crawlersApi = {
  status: () => http.get<unknown, CrawlerStatus[]>('/crawlers/status'),
  logs: () => http.get<unknown, CrawlLog[]>('/crawlers/logs'),
  run: (name: string) => http.post<unknown, CrawlResultSummary>(`/crawlers/${name}/run`),
  runAll: () => http.post<unknown, { results: CrawlResultSummary[] }>('/crawlers/run-all'),
  computeSignals: () => http.post<unknown, { ok: boolean; message: string }>('/crawlers/compute-signals'),
};

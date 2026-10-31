/** 共享类型定义 —— 两个服务与前端的单一事实源 */

// ─── 基础枚举 ────────────────────────────────────────────────────────────────

export type SourceType = 'news' | 'social' | 'forum' | 'research' | 'app';
export type MarketType = 'cn' | 'hk' | 'us';
export type SentimentLabel = 'positive' | 'neutral' | 'negative';
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type SubscriptionType = 'stock' | 'etf';

/** T011 七级金融情绪标签 */
export type FinancialSentimentLabel =
  | 'strong_positive' | 'weak_positive' | 'neutral'
  | 'weak_negative' | 'strong_negative' | 'risk' | 'rumor';

/** T012 八类结构化事件 */
export type FinancialEventType =
  | 'policy_change' | 'earnings_forecast' | 'shareholding_change' | 'merger_acquisition'
  | 'regulatory_penalty' | 'debt_default' | 'industry_prosperity' | 'rating_change';

export type EventImpactDirection = 'positive' | 'negative' | 'neutral' | 'uncertain';

// ─── 舆情内容 ────────────────────────────────────────────────────────────────

export interface NlpEntity {
  name: string;
  type: 'company' | 'index' | 'industry' | 'subscription';
}

export interface StructuredEvent {
  type: FinancialEventType;
  impactDirection: EventImpactDirection;
  confidence: number;
  triggers: string[];
  subjects: string[];
  summary: string;
}

export interface EnhancedSentimentResult {
  label: FinancialSentimentLabel;
  confidence: number;
  reasoning: string;
  modelSource: 'dictionary' | 'llm';
  positiveSignals: string[];
  negativeSignals: string[];
  riskSignals: string[];
  rumorSignals: string[];
}

/** 入库时写入的订阅匹配记录（关键字爬虫 + 相关度评分的落点） */
export interface SubscriptionMatch {
  subscriptionId: string;
  keyword: string;
  score: number;
  isCoreSubject: boolean;
  isMentionOnly: boolean;
}

export interface ContentMetrics {
  likes?: number;
  comments?: number;
  shares?: number;
  views?: number;
}

export interface ContentNlp {
  sentiment: number;
  sentimentLabel: SentimentLabel;
  riskLevel: RiskLevel;
  summary: string;
  entities: NlpEntity[];
  enhanced?: EnhancedSentimentResult;
  events?: StructuredEvent[];
}

export interface ContentItem {
  id: string;
  title: string;
  content: string;
  sourceType: SourceType;
  sourceName: string;
  author?: string;
  url?: string;
  publishedAt: string;
  fetchedAt: string;
  market: MarketType;
  metrics: ContentMetrics;
  matches: SubscriptionMatch[];
  nlp: ContentNlp;
  dedup?: { clusterId: string; similarCount: number };
}

// ─── 爬虫框架 ────────────────────────────────────────────────────────────────

export interface CrawlerConfig {
  enabled: boolean;
  intervalMinutes: number;
  pageSize: number;
  maxPages: number;
  userAgent: string;
  timeout: number;
  retries: number;
  circuitBreakerThreshold: number;
  backoffMinutes: number;
}

export interface CrawlerStatus {
  name: string;
  sourceName: string;
  sourceType: SourceType;
  enabled: boolean;
  isRunning: boolean;
  lastSuccess: boolean;
  lastError?: string;
  lastCrawlAt?: string;
  lastItemAt?: string;
  totalFetched: number;
  totalAttempts: number;
  consecutiveFailures: number;
  circuitOpen: boolean;
  circuitOpenUntil?: string;
  healthScore: number;
}

export interface CrawlResult {
  source: string;
  items: ContentItem[];
  fetchedAt: string;
  success: boolean;
  error?: string;
  duration: number;
}

export const DEFAULT_CRAWLER_CONFIG: CrawlerConfig = {
  enabled: true,
  intervalMinutes: 15,
  pageSize: 30,
  maxPages: 2,
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  timeout: 15000,
  retries: 2,
  circuitBreakerThreshold: 3,
  backoffMinutes: 10,
};

export const CRAWL_DELAY_MS = 2000;

// ─── 资金流与预测信号 ───────────────────────────────────────────────────────

export interface FundFlowDay {
  date: string; // yyyy-MM-dd
  mainNetInflow: number;
  superLargeNetInflow: number;
  largeNetInflow: number;
  mediumNetInflow: number;
  smallNetInflow: number;
  mainNetPct: number;
  closePrice: number | null;
  changePct: number | null;
}

export type SignalType =
  | 'trend_forecast'          // 资金趋势外推（预测主输出）
  | 'continuous_inflow'       // 资金持续流入
  | 'accelerating_outflow'    // 资金加速流出
  | 'top_divergence'          // 顶背离警示
  | 'bottom_divergence'       // 底背离关注
  | 'sentiment_fund_divergence' // 舆情资金双杀
  | 'resonance_positive';     // 共振向好

export type SignalDirection = 'bullish' | 'bearish' | 'neutral';

export interface FundFlowSignalDetail {
  headline: string;
  description: string;
  metrics: Record<string, number | string>;
  disclaimer: string;
}

export const SIGNAL_DISCLAIMER = '统计模型辅助信号，不构成投资建议';

/** 趋势方向中文标签（预测输出） */
export type FlowTrend = '流入加速' | '流入衰减' | '流出加速' | '流出企稳' | '横盘震荡';

// ─── 订阅热度（温度公式移植） ───────────────────────────────────────────────

export type HeatLevel = 'freezing' | 'cool' | 'neutral' | 'warm' | 'hot';

export interface SubscriptionHeat {
  subscriptionId: string;
  name: string;
  code: string;
  type: SubscriptionType;
  score: number;
  level: HeatLevel;
  emotionScore: number;    // 情绪分项 0-100
  volumeScore: number;     // 声量分项 0-100
  propagationScore: number; // 传播热度分项 0-100
  contentCount: number;
  negativeRatio: number;
}

export function heatLevel(score: number): HeatLevel {
  if (score >= 80) return 'hot';
  if (score >= 60) return 'warm';
  if (score >= 40) return 'neutral';
  if (score >= 20) return 'cool';
  return 'freezing';
}

// ─── 预警 ───────────────────────────────────────────────────────────────────

export interface AlertRuleConditions {
  /** 统计窗口（分钟），默认 120 */
  windowMinutes?: number;
  /** 命中即预警的关键词 */
  keywords?: string[];
  /** 平均情绪分低于阈值 */
  sentimentBelow?: number;
  /** 出现不低于该风险级别的内容 */
  riskLevelAbove?: RiskLevel;
  /** 负面声量后半窗相对前半窗增长率（%），如 100 = 翻倍 */
  negativeVolumeRiseAbove?: number;
  /** 触发资金信号类预警的信号类型列表 */
  signalTypes?: SignalType[];
  /** 限定信号方向 */
  signalDirection?: SignalDirection;
}

export type AlertStatus = 'pending' | 'processing' | 'resolved' | 'ignored';

// ─── 订阅 ───────────────────────────────────────────────────────────────────

export interface SubscriptionLexicon {
  id: string;
  name: string;
  code: string;
  type: SubscriptionType;
  aliases: string[];
}

import {
  Column,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';
import type {
  AlertRuleConditions,
  AlertStatus,
  ContentMetrics,
  ContentNlp,
  FinancialSentimentLabel,
  MarketType,
  RiskLevel,
  SignalDirection,
  SignalType,
  SourceType,
  SubscriptionMatch,
  SubscriptionType,
} from '../types';

/**
 * 注意：两个服务共享同一 SQLite 文件，本文件是 schema 的单一事实源，
 * 任何 app 都不得自行定义实体。全部列显式指定 type，避免依赖
 * reflect-metadata 的 design:type 推断。
 */

@Entity('subscriptions')
export class SubscriptionEntity {
  @PrimaryColumn('varchar', { length: 64 })
  id: string;

  @Column('varchar', { length: 16, default: 'stock' })
  type: SubscriptionType;

  @Column('varchar', { length: 16, unique: true })
  code: string;

  @Column('varchar', { length: 64 })
  name: string;

  /** 东方财富 secid：沪 1.XXXXXX / 深 0.XXXXXX */
  @Column('varchar', { length: 16 })
  secid: string;

  /** 别名/简称列表，用于关键字匹配 */
  @Column('simple-json', { nullable: true })
  aliases: string[] | null;

  @Column('boolean', { default: true })
  enabled: boolean;

  @Column('text', { nullable: true })
  notes: string | null;

  @Column('datetime')
  createdAt: Date;

  @Column('datetime')
  updatedAt: Date;
}

@Entity('contents')
@Index(['publishedAt'])
@Index(['sourceType'])
export class ContentEntity {
  @PrimaryColumn('varchar', { length: 64 })
  id: string;

  @Column('varchar', { length: 512 })
  title: string;

  @Column('text')
  content: string;

  @Column('varchar', { length: 32 })
  sourceType: SourceType;

  @Column('varchar', { length: 64 })
  sourceName: string;

  @Column('varchar', { length: 128, nullable: true })
  author: string | null;

  @Column('varchar', { length: 512, nullable: true })
  url: string | null;

  @Column('datetime')
  publishedAt: Date;

  @Column('datetime')
  fetchedAt: Date;

  @Column('varchar', { length: 8, default: 'cn' })
  market: MarketType;

  @Column('simple-json', { nullable: true })
  metrics: ContentMetrics | null;

  @Column('simple-json', { nullable: true })
  matches: SubscriptionMatch[] | null;

  @Column('simple-json')
  nlp: ContentNlp;

  @Column('simple-json', { nullable: true })
  dedup: { clusterId: string; similarCount: number } | null;
}

/** 每日资金流快照（来源：东方财富 push2his 日K资金流接口） */
@Entity('fund_flow_daily')
@Index(['code', 'date'], { unique: true })
export class FundFlowDailyEntity {
  /** code:date */
  @PrimaryColumn('varchar', { length: 40 })
  id: string;

  /** 个股/ETF 为 6 位代码；上证大盘基准为 'sh000001' */
  @Column('varchar', { length: 16 })
  code: string;

  @Column('varchar', { length: 16 })
  secid: string;

  /** 交易日 yyyy-MM-dd（东财返回格式） */
  @Column('varchar', { length: 10 })
  date: string;

  @Column('real', { default: 0 })
  mainNetInflow: number;

  @Column('real', { default: 0 })
  superLargeNetInflow: number;

  @Column('real', { default: 0 })
  largeNetInflow: number;

  @Column('real', { default: 0 })
  mediumNetInflow: number;

  @Column('real', { default: 0 })
  smallNetInflow: number;

  @Column('real', { default: 0 })
  mainNetPct: number;

  @Column('real', { nullable: true })
  closePrice: number | null;

  @Column('real', { nullable: true })
  changePct: number | null;

  @Column('datetime')
  fetchedAt: Date;
}

@Entity('fund_flow_signals')
@Index(['date'])
export class FundFlowSignalEntity {
  /** date:subscriptionId:signalType */
  @PrimaryColumn('varchar', { length: 128 })
  id: string;

  @Column('varchar', { length: 10 })
  date: string;

  @Column('varchar', { length: 64 })
  subscriptionId: string;

  @Column('varchar', { length: 16 })
  code: string;

  @Column('varchar', { length: 64 })
  name: string;

  @Column('varchar', { length: 32 })
  signalType: SignalType;

  @Column('varchar', { length: 16 })
  direction: SignalDirection;

  /** 0-100 */
  @Column('integer', { default: 50 })
  strength: number;

  @Column('simple-json')
  detail: Record<string, any>;

  @Column('datetime')
  createdAt: Date;
}

@Entity('crawl_logs')
@Index(['crawledAt'])
export class CrawlLogEntity {
  @PrimaryColumn('varchar', { length: 64 })
  id: string;

  @Column('varchar', { length: 64 })
  source: string;

  @Column('datetime')
  crawledAt: Date;

  @Column('integer', { default: 0 })
  itemsFetched: number;

  @Column('integer', { default: 0 })
  itemsAdded: number;

  @Column('boolean', { default: true })
  success: boolean;

  @Column('integer', { default: 0 })
  duration: number;

  @Column('text', { nullable: true })
  error: string | null;
}

@Entity('alerts')
@Index(['triggeredAt'])
export class AlertEntity {
  @PrimaryColumn('varchar', { length: 80 })
  id: string;

  @Column('varchar', { length: 256 })
  title: string;

  @Column('text')
  description: string;

  @Column('varchar', { length: 16, default: 'medium' })
  riskLevel: RiskLevel;

  @Column('varchar', { length: 64 })
  source: string;

  @Column('datetime')
  triggeredAt: Date;

  @Column('varchar', { length: 16, default: 'pending' })
  status: AlertStatus;

  @Column('datetime', { nullable: true })
  handledAt: Date | null;

  @Column('text', { nullable: true })
  handleNote: string | null;

  @Column('simple-json', { nullable: true })
  triggerMeta: Record<string, any> | null;
}

@Entity('alert_rules')
export class AlertRuleEntity {
  @PrimaryColumn('varchar', { length: 64 })
  id: string;

  @Column('varchar', { length: 128 })
  name: string;

  @Column('boolean', { default: true })
  enabled: boolean;

  @Column('simple-json')
  conditions: AlertRuleConditions;

  @Column('varchar', { length: 16, nullable: true })
  riskLevel: RiskLevel | null;

  @Column('datetime')
  createdAt: Date;

  @Column('datetime')
  updatedAt: Date;
}

/** 数据源可信度配置（预留，温度/热度计算可用） */
@Entity('source_configs')
export class SourceConfigEntity {
  @PrimaryColumn('varchar', { length: 64 })
  id: string;

  @Column('varchar', { length: 64 })
  sourceName: string;

  @Column('varchar', { length: 32 })
  sourceType: SourceType;

  @Column('integer', { default: 80 })
  credibility: number;

  @Column('boolean', { default: true })
  includeInTemperature: boolean;

  @Column('boolean', { default: true })
  enabled: boolean;
}

@Entity('lexicons')
export class LexiconEntity {
  @PrimaryColumn('varchar', { length: 64 })
  id: string;

  @Column('varchar', { length: 64 })
  word: string;

  /** brand | risk | synonym | stop | custom */
  @Column('varchar', { length: 32, default: 'custom' })
  category: string;

  @Column('simple-json', { nullable: true })
  synonyms: string[] | null;

  @Column('datetime')
  createdAt: Date;
}

/** 订阅热度快照（api 服务按需计算后写入） */
@Entity('temperature_snapshots')
@Index(['subscriptionId', 'granularity', 'bucketTs'], { unique: true })
export class TemperatureSnapshotEntity {
  @PrimaryColumn('varchar', { length: 96 })
  id: string;

  @Column('varchar', { length: 64 })
  subscriptionId: string;

  @Column('varchar', { length: 16 })
  granularity: 'hour' | 'day';

  /** 时间桶起点 ISO 字符串 */
  @Column('varchar', { length: 32 })
  bucketTs: string;

  @Column('real')
  score: number;

  /** 情绪/声量/传播三你项 + 统计 */
  @Column('simple-json')
  breakdown: Record<string, number>;

  @Column('datetime')
  computedAt: Date;
}

/** 便捷映射：七级标签 → 三分类 */
export function toBaseSentimentLabel(label: FinancialSentimentLabel): 'positive' | 'neutral' | 'negative' {
  switch (label) {
    case 'strong_positive':
    case 'weak_positive':
      return 'positive';
    case 'strong_negative':
    case 'weak_negative':
    case 'risk':
      return 'negative';
    default:
      return 'neutral';
  }
}

/** TypeORM 数据源注册用的实体清单（两个服务共用） */
export const CORE_ENTITIES = [
  SubscriptionEntity,
  ContentEntity,
  FundFlowDailyEntity,
  FundFlowSignalEntity,
  CrawlLogEntity,
  AlertEntity,
  AlertRuleEntity,
  SourceConfigEntity,
  LexiconEntity,
  TemperatureSnapshotEntity,
] as const;

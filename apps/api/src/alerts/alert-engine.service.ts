import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThanOrEqual, In } from 'typeorm';
import { v4 as uuid } from 'uuid';
import {
  AlertEntity,
  AlertRuleEntity,
  ContentEntity,
  FundFlowSignalEntity,
  heatLevel,
  SubscriptionEntity,
  type AlertRuleConditions,
  type RiskLevel,
} from '@fin/core';
import { TemperatureService } from '../temperature/temperature.service';

const RISK_ORDER: RiskLevel[] = ['low', 'medium', 'high', 'critical'];

/**
 * 预警规则引擎（移植原 alertEvaluationService 思路，新增资金信号条件）：
 * 每 5 分钟评估一次启用规则；内存冷却 Map 防重；pending 同名预警去重。
 * 条件类型：keywords / sentimentBelow / riskLevelAbove / negativeVolumeRiseAbove /
 *          signalTypes + signalDirection（资金信号）/ temperatureAbove（订阅热度）。
 */
@Injectable()
export class AlertEngineService implements OnModuleInit {
  private readonly logger = new Logger(AlertEngineService.name);
  /** key → 上次触发时间（ms） */
  private cooldowns = new Map<string, number>();

  constructor(
    @InjectRepository(AlertEntity) private readonly alertRepo: Repository<AlertEntity>,
    @InjectRepository(AlertRuleEntity) private readonly ruleRepo: Repository<AlertRuleEntity>,
    @InjectRepository(ContentEntity) private readonly contentRepo: Repository<ContentEntity>,
    @InjectRepository(FundFlowSignalEntity) private readonly signalRepo: Repository<FundFlowSignalEntity>,
    @InjectRepository(SubscriptionEntity) private readonly subRepo: Repository<SubscriptionEntity>,
    private readonly temperature: TemperatureService,
  ) {}

  /** 默认规则种入 */
  async onModuleInit(): Promise<void> {
    if (process.env.SEED_DEMO === 'false') return;
    const count = await this.ruleRepo.count();
    if (count > 0) return;
    await this.ruleRepo.insert([
      {
        id: 'rule-risk-keywords',
        name: '高风险内容关键词预警',
        enabled: true,
        conditions: {
          windowMinutes: 240,
          keywords: ['暴雷', '立案调查', '债务违约', '退市', '被查', '破产'],
          riskLevelAbove: 'high',
        },
        riskLevel: 'high',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'rule-bearish-signal',
        name: '资金利空信号预警',
        enabled: true,
        conditions: {
          windowMinutes: 1440,
          signalDirection: 'bearish',
          signalTypes: ['accelerating_outflow', 'top_divergence', 'sentiment_fund_divergence'],
        },
        riskLevel: 'medium',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'rule-negative-rise',
        name: '负面声量突增预警',
        enabled: true,
        conditions: { windowMinutes: 240, negativeVolumeRiseAbove: 100 },
        riskLevel: 'medium',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    this.logger.log('Seeded 3 default alert rules');
  }

  @Cron('*/5 * * * *')
  async evaluateCron(): Promise<void> {
    try {
      const generated = await this.evaluateOnce();
      if (generated > 0) this.logger.log(`[alert] ${generated} new alerts generated`);
    } catch (err) {
      this.logger.error(`[alert] evaluate failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  async evaluateOnce(): Promise<number> {
    const rules = await this.ruleRepo.find({ where: { enabled: true } });
    if (rules.length === 0) return 0;

    const pendingTitles = new Set(
      (await this.alertRepo.find({ select: ['title'], where: { status: In(['pending', 'processing']) } })).map(
        (a) => a.title,
      ),
    );

    let created = 0;
    for (const rule of rules) {
      created += await this.evaluateRule(rule, pendingTitles);
    }
    return created;
  }

  private async evaluateRule(rule: AlertRuleEntity, pendingTitles: Set<string>): Promise<number> {
    const cond: AlertRuleConditions = rule.conditions;
    const windowMs = (cond.windowMinutes ?? 120) * 60 * 1000;
    const since = new Date(Date.now() - windowMs);
    let created = 0;

    // 1) 关键词 + 风险等级（内容维度）
    if (cond.keywords?.length || cond.riskLevelAbove) {
      const items = await this.contentRepo.find({
        where: { publishedAt: MoreThanOrEqual(since) },
        order: { publishedAt: 'DESC' },
        take: 500,
      });
      for (const item of items) {
        const text = `${item.title} ${item.content}`;
        const kwHit = cond.keywords?.some((k) => text.includes(k));
        const riskHit = cond.riskLevelAbove
          ? RISK_ORDER.indexOf(item.nlp?.riskLevel ?? 'low') >= RISK_ORDER.indexOf(cond.riskLevelAbove)
          : false;
        if (!kwHit && !riskHit) continue;

        const key = `risk-content-${item.id}`;
        if (!this.shouldFire(key, 24 * 3600 * 1000)) continue;
        const title = `风险内容：${item.title.slice(0, 60)}`;
        if (pendingTitles.has(title)) continue;

        const riskAlert: AlertEntity = {
          id: uuid(),
          title,
          description: `「${item.sourceName}」${
            kwHit ? `命中关键词「${cond.keywords?.filter((k) => text.includes(k)).join('、')}」` : ''
          }${kwHit && riskHit ? '，' : ''}${
            riskHit ? `风险级别 ${item.nlp?.riskLevel}` : ''
          }。${item.content.slice(0, 120)}`,
          riskLevel: item.nlp?.riskLevel === 'critical' ? 'critical' : rule.riskLevel ?? 'medium',
          source: item.sourceName,
          triggeredAt: new Date(),
          status: 'pending',
          handleNote: null,
          handledAt: null,
          triggerMeta: { contentId: item.id, url: item.url, ruleId: rule.id },
        };
        await this.alertRepo.insert(riskAlert);
        this.cooldowns.set(key, Date.now());
        pendingTitles.add(title);
        created += 1;
      }
    }

    // 2) 负面声量突增
    if (cond.negativeVolumeRiseAbove !== undefined) {
      const items = await this.contentRepo.find({
        select: ['id', 'nlp', 'publishedAt'],
        where: { publishedAt: MoreThanOrEqual(since) },
      });
      const negatives = items.filter((i) => i.nlp?.sentimentLabel === 'negative');
      const mid = since.getTime() + windowMs / 2;
      const firstHalf = negatives.filter((i) => i.publishedAt.getTime() < mid).length;
      const secondHalf = negatives.filter((i) => i.publishedAt.getTime() >= mid).length;
      const risePct = firstHalf === 0 ? (secondHalf > 0 ? Infinity : 0) : ((secondHalf - firstHalf) / firstHalf) * 100;
      if (secondHalf >= 3 && risePct >= (cond.negativeVolumeRiseAbove ?? 100)) {
        const key = `neg-rise-${rule.id}`;
        if (this.shouldFire(key, 30 * 60 * 1000)) {
          const title = `负面声量突增预警（+${Number.isFinite(risePct) ? Math.round(risePct) : '∞'}%）`;
          if (!pendingTitles.has(title)) {
            const riseAlert: AlertEntity = {
              id: uuid(),
              title,
              description: `时间窗内负面内容后半段 ${secondHalf} 条 vs 前半段 ${firstHalf} 条，增长率 ${Number.isFinite(risePct) ? Math.round(risePct) : '∞'}%。`,
              riskLevel: risePct >= 200 ? 'high' : 'medium',
              source: 'alert-engine',
              triggeredAt: new Date(),
              status: 'pending',
              handleNote: null,
              handledAt: null,
              triggerMeta: { firstHalf, secondHalf, risePct: Number.isFinite(risePct) ? Math.round(risePct) : null },
            };
            await this.alertRepo.insert(riseAlert);
            this.cooldowns.set(key, Date.now());
            pendingTitles.add(title);
            created += 1;
          }
        }
      }
    }

    // 3) 资金信号类（新增）
    if (cond.signalDirection || cond.signalTypes?.length) {
      const signals = await this.signalRepo.find({
        where: { date: MoreThanOrEqual(since.toISOString().slice(0, 10)) },
      });
      for (const sig of signals) {
        if (cond.signalDirection && sig.direction !== cond.signalDirection) continue;
        if (cond.signalTypes?.length && !cond.signalTypes.includes(sig.signalType)) continue;
        const key = `signal-${sig.id}`;
        if (!this.shouldFire(key, 24 * 3600 * 1000)) continue;
        const title = `资金信号：${(sig.detail as { headline?: string })?.headline ?? sig.signalType}（${sig.name}）`;
        if (pendingTitles.has(title)) continue;
          const signalAlert: AlertEntity = {
            id: uuid(),
            title,
            description: `${(sig.detail as { description?: string })?.description ?? ''}（${sig.date}，强度 ${sig.strength}）`,
            riskLevel: rule.riskLevel ?? 'medium',
            source: 'fund-signal',
            triggeredAt: new Date(),
            status: 'pending',
            handleNote: null,
            handledAt: null,
            triggerMeta: { signalId: sig.id, subscriptionId: sig.subscriptionId, code: sig.code },
          };
          await this.alertRepo.insert(signalAlert);
        this.cooldowns.set(key, Date.now());
        pendingTitles.add(title);
        created += 1;
      }
    }

    // 4) 订阅热度过热
    if (cond.windowMinutes && !cond.keywords?.length && !cond.riskLevelAbove && !cond.signalDirection && cond.negativeVolumeRiseAbove === undefined) {
      const heat = await this.temperature.computeAll();
      for (const h of heat) {
        if (h.score >= 80 && heatLevel(h.score) === 'hot') {
          const key = `heat-${rule.id}-${h.subscriptionId}`;
          if (!this.shouldFire(key, 3600 * 1000)) continue;
          const title = `订阅热度过热：${h.name}（${h.score}）`;
          if (pendingTitles.has(title)) continue;
          const heatAlert: AlertEntity = {
            id: uuid(),
            title,
            description: `${h.name}(${h.code}) 热度指数 ${h.score}，近24h相关内容 ${h.contentCount} 条，负面占比 ${(h.negativeRatio * 100).toFixed(0)}%。`,
            riskLevel: h.score >= 90 ? 'critical' : 'high',
            source: 'temperature',
            triggeredAt: new Date(),
            status: 'pending',
            handleNote: null,
            handledAt: null,
            triggerMeta: { subscriptionId: h.subscriptionId, score: h.score },
          };
          await this.alertRepo.insert(heatAlert);
          this.cooldowns.set(key, Date.now());
          pendingTitles.add(title);
          created += 1;
        }
      }
    }

    return created;
  }

  private shouldFire(key: string, cooldownMs: number): boolean {
    const last = this.cooldowns.get(key);
    if (!last) return true;
    return Date.now() - last > cooldownMs;
  }

  resetCooldowns(): void {
    this.cooldowns.clear();
  }
}

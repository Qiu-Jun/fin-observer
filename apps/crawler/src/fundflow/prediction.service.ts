import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual, MoreThanOrEqual } from 'typeorm';
import {
  SIGNAL_DISCLAIMER,
  formatTradeDate,
  ContentEntity,
  FundFlowDailyEntity,
  FundFlowSignalEntity,
  SubscriptionEntity,
  type FlowTrend,
  type SignalDirection,
  type SignalType,
} from '@fin/core';

/** 资金流分析用的日行视图 */
interface FlowRow {
  date: string;
  mainNetInflow: number;
  mainNetPct: number;
  closePrice: number | null;
}

/**
 * 预测信号服务（统计模型 + 规则信号，定位为辅助信号）：
 * - trend_forecast：近 10 日主力净占比的加权移动平均 + 线性回归斜率 → 未来 3 日趋势方向，R² 作置信度
 * - 规则信号：持续流入 / 加速流出 / 顶背离 / 底背离 / 舆情资金双杀 / 共振向好
 * 每交易日 15:20 cron 运行，同时可由 gRPC ComputeSignals 手动触发。
 */
@Injectable()
export class PredictionService {
  private readonly logger = new Logger(PredictionService.name);

  constructor(
    @InjectRepository(FundFlowDailyEntity)
    private readonly flowRepo: Repository<FundFlowDailyEntity>,
    @InjectRepository(FundFlowSignalEntity)
    private readonly signalRepo: Repository<FundFlowSignalEntity>,
    @InjectRepository(ContentEntity)
    private readonly contentRepo: Repository<ContentEntity>,
    @InjectRepository(SubscriptionEntity)
    private readonly subRepo: Repository<SubscriptionEntity>,
  ) {}

  async computeAllSignals(): Promise<number> {
    const subs = await this.subRepo.find({ where: { enabled: true } });
    let count = 0;
    for (const sub of subs) {
      try {
        count += await this.computeForSubscription(sub);
      } catch (err) {
        this.logger.warn(`[prediction] ${sub.code} ${sub.name} failed: ${err instanceof Error ? err.message : err}`);
      }
    }
    this.logger.log(`[prediction] computed ${count} signals for ${subs.length} subscriptions`);
    return count;
  }

  async computeForSubscription(sub: SubscriptionEntity): Promise<number> {
    const today = formatTradeDate();
    const rows = await this.flowRepo.find({
      where: { code: sub.code, date: LessThanOrEqual(today) },
      order: { date: 'ASC' },
      take: 40,
    });
    if (rows.length < 15) {
      this.logger.warn(`[prediction] ${sub.code} insufficient flow history (${rows.length} rows), skip`);
      return 0;
    }

    const view: FlowRow[] = rows.map((r) => ({
      date: r.date,
      mainNetInflow: r.mainNetInflow,
      mainNetPct: r.mainNetPct,
      closePrice: r.closePrice,
    }));

    const signals = await this.buildSignals(sub, view);

    // 当日重算幂等：先清掉今天的，再写入
    await this.signalRepo.delete({ date: today, subscriptionId: sub.id });
    for (const s of signals) {
      const entity = this.signalRepo.create({
        id: `${today}:${sub.id}:${s.signalType}`,
        date: today,
        subscriptionId: sub.id,
        code: sub.code,
        name: sub.name,
        signalType: s.signalType,
        direction: s.direction,
        strength: s.strength,
        detail: s.detail,
        createdAt: new Date(),
      });
      await this.signalRepo.insert(entity as FundFlowSignalEntity);
    }
    return signals.length;
  }

  private async buildSignals(
    sub: SubscriptionEntity,
    rows: FlowRow[],
  ): Promise<Array<{ signalType: SignalType; direction: SignalDirection; strength: number; detail: Record<string, unknown> }>> {
    const out: Array<{ signalType: SignalType; direction: SignalDirection; strength: number; detail: Record<string, unknown> }> = [];
    const last = rows[rows.length - 1];
    const pct = rows.map((r) => r.mainNetPct);
    const inflow = rows.map((r) => r.mainNetInflow);

    // ── 1. 趋势外推（trend_forecast）────────────────────────────────────────
    const wma5 = weightedMovingAverage(pct.slice(-10), 5);
    const reg = linearRegression(wma5.map((v, i) => [i, v]));
    const mean5 = avg(pct.slice(-5));
    let trend: FlowTrend = '横盘震荡';
    let direction: SignalDirection = 'neutral';
    if (reg.slope > 0.05 && mean5 > 0) {
      trend = '流入加速';
      direction = 'bullish';
    } else if (reg.slope > 0.05) {
      trend = '流出企稳';
      direction = 'neutral';
    } else if (reg.slope < -0.05 && mean5 < 0) {
      trend = '流出加速';
      direction = 'bearish';
    } else if (reg.slope < -0.05) {
      trend = '流入衰减';
      direction = 'neutral';
    }
    const strength = Math.round(Math.min(95, 40 + reg.r2 * 55));
    out.push({
      signalType: 'trend_forecast',
      direction,
      strength,
      detail: {
        headline: `资金趋势研判：${trend}`,
        description:
          `近10日主力净占比加权均线斜率 ${reg.slope.toFixed(3)}/日（R²=${reg.r2.toFixed(2)}），近5日均值 ${mean5.toFixed(2)}%。` +
          `统计模型倾向：未来3日主力资金${reg.slope > 0.05 ? '回升' : reg.slope < -0.05 ? '继续回落' : '横盘'}。`,
        metrics: {
          slope: Number(reg.slope.toFixed(4)),
          r2: Number(reg.r2.toFixed(3)),
          meanPct5: Number(mean5.toFixed(2)),
          latestPct: Number(last.mainNetPct.toFixed(2)),
          trend,
        },
        disclaimer: SIGNAL_DISCLAIMER,
      },
    });

    // ── 2. 持续流入 ────────────────────────────────────────────────────────
    const last5 = inflow.slice(-5);
    if (last5.length === 5 && last5.every((v) => v > 0)) {
      const prev5 = avg(pct.slice(-10, -5));
      const cur5 = avg(pct.slice(-5));
      const rising = cur5 > prev5;
      out.push({
        signalType: 'continuous_inflow',
        direction: 'bullish',
        strength: Math.min(90, 50 + Math.round(cur5 * 4)),
        detail: {
          headline: `资金持续流入：连续 ${last5.length} 日主力净流入`,
          description: `近5日主力累计净流入 ${(sum(last5) / 1e8).toFixed(2)} 亿元，净占比均值 ${cur5.toFixed(2)}%（前5日 ${prev5.toFixed(2)}%）${rising ? '，强度抬升' : ''}。`,
          metrics: {
            sumInflow5: Math.round(sum(last5)),
            curPct: Number(cur5.toFixed(2)),
            prevPct: Number(prev5.toFixed(2)),
          },
          disclaimer: SIGNAL_DISCLAIMER,
        },
      });
    }

    // ── 3. 加速流出 ────────────────────────────────────────────────────────
    const last3 = inflow.slice(-3);
    if (last3.length === 3 && last3.every((v) => v < 0) && Math.abs(last3[2]) > Math.abs(last3[1]) && Math.abs(last3[1]) > Math.abs(last3[0])) {
      out.push({
        signalType: 'accelerating_outflow',
        direction: 'bearish',
        strength: 75,
        detail: {
          headline: '资金加速流出：连续 3 日主力净流出且逐日放大',
          description: `近3日主力净流出 ${(Math.abs(sum(last3)) / 1e8).toFixed(2)} 亿元，流出规模逐日扩大，注意风险。`,
          metrics: { sumOutflow3: Math.round(sum(last3)) },
          disclaimer: SIGNAL_DISCLAIMER,
        },
      });
    }

    // ── 4. 顶背离：价格 20 日新高 + 主力资金 3 日净流出 ────────────────────
    const closes = rows.map((r) => r.closePrice ?? 0).filter((v) => v > 0);
    const recent20 = rows.slice(-20);
    if (closes.length >= 20) {
      const high20 = Math.max(...closes.slice(-20));
      const nearHigh = (last.closePrice ?? 0) >= high20 * 0.995;
      const outflow3 = sum(inflow.slice(-3));
      if (nearHigh && outflow3 < 0) {
        out.push({
          signalType: 'top_divergence',
          direction: 'bearish',
          strength: 70,
          detail: {
            headline: '顶背离警示：价格接近 20 日新高但主力资金流出',
            description: `收盘价 ${last.closePrice} 逼近 20 日高点 ${high20.toFixed(2)}，而近3日主力累计净流出 ${(Math.abs(outflow3) / 1e8).toFixed(2)} 亿元，量价背离需警惕。`,
            metrics: { close: last.closePrice ?? 0, high20: Number(high20.toFixed(2)), outflow3: Math.round(outflow3) },
            disclaimer: SIGNAL_DISCLAIMER,
          },
        });
      }
    }

    // ── 5. 底背离：价格 20 日新低 + 主力资金 3 日净流入 ────────────────────
    if (closes.length >= 20) {
      const low20 = Math.min(...recent20.map((r) => r.closePrice ?? 0).filter((v) => v > 0));
      const nearLow = (last.closePrice ?? 0) <= low20 * 1.005;
      const inflow3 = sum(inflow.slice(-3));
      if (nearLow && inflow3 > 0) {
        out.push({
          signalType: 'bottom_divergence',
          direction: 'bullish',
          strength: 65,
          detail: {
            headline: '底背离关注：价格接近 20 日新低但主力资金流入',
            description: `收盘价 ${last.closePrice} 逼近 20 日低点 ${low20.toFixed(2)}，而近3日主力累计净流入 ${(inflow3 / 1e8).toFixed(2)} 亿元，可关注承接迹象。`,
            metrics: { close: last.closePrice ?? 0, low20: Number(low20.toFixed(2)), inflow3: Math.round(inflow3) },
            disclaimer: SIGNAL_DISCLAIMER,
          },
        });
      }
    }

    // ── 6. 舆情×资金 共振信号（需要内容数据）───────────────────────────────
    const sentimentStats = await this.recentSentimentStats(sub.id);
    if (sentimentStats) {
      const inflow3 = sum(inflow.slice(-3));
      if (sentimentStats.negativeRatio >= 0.5 && sentimentStats.total >= 5 && inflow3 < 0) {
        out.push({
          signalType: 'sentiment_fund_divergence',
          direction: 'bearish',
          strength: 85,
          detail: {
            headline: '舆情资金双杀：负面舆情集中 + 主力资金流出',
            description: `近48小时 ${sentimentStats.total} 条相关内容中负面占比 ${(sentimentStats.negativeRatio * 100).toFixed(0)}%，且近3日主力累计净流出 ${(Math.abs(inflow3) / 1e8).toFixed(2)} 亿元，共振向下。`,
            metrics: {
              negativeRatio: Number(sentimentStats.negativeRatio.toFixed(2)),
              contentCount: sentimentStats.total,
              inflow3: Math.round(inflow3),
            },
            disclaimer: SIGNAL_DISCLAIMER,
          },
        });
      }
      if (sentimentStats.positiveRatio >= 0.4 && sentimentStats.total >= 5 && inflow3 > 0) {
        out.push({
          signalType: 'resonance_positive',
          direction: 'bullish',
          strength: 75,
          detail: {
            headline: '共振向好：正面舆情 + 主力资金流入',
            description: `近48小时 ${sentimentStats.total} 条相关内容中正面占比 ${(sentimentStats.positiveRatio * 100).toFixed(0)}%，且近3日主力累计净流入 ${(inflow3 / 1e8).toFixed(2)} 亿元，共振向上。`,
            metrics: {
              positiveRatio: Number(sentimentStats.positiveRatio.toFixed(2)),
              contentCount: sentimentStats.total,
              inflow3: Math.round(inflow3),
            },
            disclaimer: SIGNAL_DISCLAIMER,
          },
        });
      }
    }

    return out;
  }

  /** 近 48h 内命中该订阅的内容情绪统计（matches JSON LIKE 检索） */
  private async recentSentimentStats(
    subscriptionId: string,
  ): Promise<{ total: number; negativeRatio: number; positiveRatio: number } | null> {
    const since = new Date(Date.now() - 48 * 3600 * 1000);
    const rows = await this.contentRepo.find({
      select: { nlp: true },
      where: { publishedAt: MoreThanOrEqual(since) },
    });
    // matches 为 JSON 文本列，like 过滤在 SQL 层做更高效；此处小数据量先内存过滤
    const matched = rows.filter((r) =>
      JSON.stringify(r.matches ?? []).includes(subscriptionId),
    );
    if (matched.length === 0) return null;
    const neg = matched.filter((r) => r.nlp?.sentimentLabel === 'negative').length;
    const pos = matched.filter((r) => r.nlp?.sentimentLabel === 'positive').length;
    return {
      total: matched.length,
      negativeRatio: neg / matched.length,
      positiveRatio: pos / matched.length,
    };
  }
}

// ─── 统计工具 ────────────────────────────────────────────────────────────────

function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function sum(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0);
}

/** 加权移动平均（权重线性递增：最近的点权重最高） */
function weightedMovingAverage(values: number[], window: number): number[] {
  const out: number[] = [];
  for (let i = window - 1; i < values.length; i++) {
    let num = 0;
    let den = 0;
    for (let j = 0; j < window; j++) {
      const w = j + 1;
      num += values[i - window + 1 + j] * w;
      den += w;
    }
    out.push(num / den);
  }
  return out;
}

/** 一元线性回归：返回斜率与 R² */
function linearRegression(points: Array<[number, number]>): { slope: number; intercept: number; r2: number } {
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: points[0]?.[1] ?? 0, r2: 0 };
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const mx = avg(xs);
  const my = avg(ys);
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) ** 2;
    sxy += (xs[i] - mx) * (ys[i] - my);
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = my - slope * mx;
  let ssTot = 0;
  let ssRes = 0;
  for (let i = 0; i < n; i++) {
    const pred = slope * xs[i] + intercept;
    ssTot += (ys[i] - my) ** 2;
    ssRes += (ys[i] - pred) ** 2;
  }
  const r2 = ssTot === 0 ? 0 : Math.max(0, 1 - ssRes / ssTot);
  return { slope, intercept, r2 };
}

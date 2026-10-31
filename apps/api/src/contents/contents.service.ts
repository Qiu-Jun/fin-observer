import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { analyzeSentimentSingle, ContentEntity } from '@fin/core';

export interface ContentsQuery {
  q?: string;
  subscriptionId?: string;
  sourceType?: string;
  sentiment?: string;
  riskLevel?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
}

/**
 * 舆情检索：SQL LIKE + 索引（替代原项目全表内存扫描）。
 * matches/nlp 为 JSON 文本列，用 LIKE 过滤在单机数据量下毫秒级。
 */
@Injectable()
export class ContentsService {
  constructor(
    @InjectRepository(ContentEntity)
    private readonly repo: Repository<ContentEntity>,
  ) {}

  async search(query: ContentsQuery) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));

    const qb = this.repo.createQueryBuilder('c');
    if (query.q) {
      qb.andWhere('(c.title LIKE :q OR c.content LIKE :q)', { q: `%${query.q}%` });
    }
    if (query.subscriptionId) {
      qb.andWhere('c.matches LIKE :mid', { mid: `%"${query.subscriptionId}"%` });
    }
    if (query.sourceType) {
      qb.andWhere('c.sourceType = :sourceType', { sourceType: query.sourceType });
    }
    if (query.sentiment) {
      qb.andWhere('c.nlp LIKE :sent', { sent: `%"sentimentLabel":"${query.sentiment}"%` });
    }
    if (query.riskLevel) {
      qb.andWhere('c.nlp LIKE :risk', { risk: `%"riskLevel":"${query.riskLevel}"%` });
    }
    if (query.dateFrom) {
      qb.andWhere('c.publishedAt >= :from', { from: new Date(query.dateFrom) });
    }
    if (query.dateTo) {
      qb.andWhere('c.publishedAt <= :to', { to: new Date(query.dateTo) });
    }

    qb.orderBy('c.publishedAt', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize);

    const [items, total] = await qb.getManyAndCount();
    return { items, total, page, pageSize };
  }

  async get(id: string): Promise<ContentEntity> {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException(`Content not found: ${id}`);
    return item;
  }

  /** 时间窗口内聚合统计（情绪/风险/来源分布） */
  async stats(days = 7) {
    const since = new Date(Date.now() - days * 86400 * 1000);
    const rows = await this.repo.find({
      select: ['id', 'sourceType', 'nlp', 'matches', 'metrics'],
      where: { publishedAt: since },
    });

    const sentiment = { positive: 0, neutral: 0, negative: 0 };
    const risk = { low: 0, medium: 0, high: 0, critical: 0 };
    const bySource: Record<string, number> = {};
    for (const r of rows) {
      const label = r.nlp?.sentimentLabel ?? 'neutral';
      sentiment[label] = (sentiment[label] ?? 0) + 1;
      const rl = r.nlp?.riskLevel ?? 'low';
      risk[rl] = (risk[rl] ?? 0) + 1;
      bySource[r.sourceType] = (bySource[r.sourceType] ?? 0) + 1;
    }
    return { total: rows.length, days, sentiment, risk, bySource };
  }

  /** 结构化事件分布（近 N 天） */
  async eventDistribution(days = 7) {
    const since = new Date(Date.now() - days * 86400 * 1000);
    const rows = await this.repo.find({
      select: ['id', 'nlp', 'publishedAt'],
      where: { publishedAt: since },
    });
    const byType: Record<string, number> = {};
    const byDirection: Record<string, number> = {};
    let totalEvents = 0;
    for (const r of rows) {
      for (const ev of r.nlp?.events ?? []) {
        totalEvents += 1;
        byType[ev.type] = (byType[ev.type] ?? 0) + 1;
        byDirection[ev.impactDirection] = (byDirection[ev.impactDirection] ?? 0) + 1;
      }
    }
    return { totalEvents, days, byType, byDirection };
  }

  /** 事件时间线：带事件的最新内容 */
  async eventTimeline(days = 7, limit = 50, eventType?: string) {
    const since = new Date(Date.now() - days * 86400 * 1000);
    const rows = await this.repo.find({
      where: { publishedAt: since },
      order: { publishedAt: 'DESC' },
      take: 400,
    });
    const out = rows
      .filter((r) => (r.nlp?.events ?? []).length > 0)
      .flatMap((r) =>
        (r.nlp.events ?? [])
          .filter((ev) => !eventType || ev.type === eventType)
          .map((ev) => ({
            contentId: r.id,
            title: r.title,
            sourceName: r.sourceName,
            publishedAt: r.publishedAt,
            event: ev,
          })),
      )
      .slice(0, limit);
    return out;
  }

  /** 手动触发单条 LLM 重分析 */
  async reanalyze(id: string) {
    const item = await this.get(id);
    const result = await analyzeSentimentSingle(`${item.title} ${item.content}`, item.sourceType);
    item.nlp = {
      ...item.nlp,
      enhanced: {
        label: result.label,
        confidence: result.confidence,
        reasoning: result.reasoning,
        modelSource: result.modelSource,
        positiveSignals: result.positiveSignals,
        negativeSignals: result.negativeSignals,
        riskSignals: result.riskSignals,
        rumorSignals: result.rumorSignals,
      },
    };
    await this.repo.save(item);
    return item;
  }
}

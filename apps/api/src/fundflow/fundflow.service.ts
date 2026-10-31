import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FundFlowDailyEntity, FundFlowSignalEntity, MARKET_INDEX_CODE, SubscriptionEntity } from '@fin/core';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';

/**
 * 资金流查询面：历史日K、订阅摘要（最新5日累计）、预测信号列表。
 */
@Injectable()
export class FundflowQueryService {
  constructor(
    @InjectRepository(FundFlowDailyEntity)
    private readonly flowRepo: Repository<FundFlowDailyEntity>,
    @InjectRepository(FundFlowSignalEntity)
    private readonly signalRepo: Repository<FundFlowSignalEntity>,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  /** 某代码的日K资金流（升序返回，供图表直接使用） */
  async getFlow(code: string, days = 60) {
    const rows = await this.flowRepo.find({
      where: { code },
      order: { date: 'DESC' },
      take: days,
    });
    if (rows.length === 0) throw new NotFoundException(`No fund flow data for ${code}`);
    return rows.reverse();
  }

  /** 订阅资金流摘要：最新一日 + 5 日主力累计 */
  async summaries() {
    const subs = await this.subscriptions.list();
    const out = [];
    for (const sub of subs) {
      const rows = await this.flowRepo.find({
        where: { code: sub.code },
        order: { date: 'DESC' },
        take: 5,
      });
      const latest = rows[0] ?? null;
      const sum5 = rows.reduce((acc, r) => acc + r.mainNetInflow, 0);
      out.push({
        subscription: sub,
        latest,
        sumMain5: sum5,
        rowsCount: rows.length,
      });
    }
    return out;
  }

  /** 大盘基准（上证指数）最近 N 日 */
  async marketFlow(days = 30) {
    const rows = await this.flowRepo.find({
      where: { code: MARKET_INDEX_CODE },
      order: { date: 'DESC' },
      take: days,
    });
    return rows.reverse();
  }

  async signals(opts: { subscriptionId?: string; direction?: string; days?: number; limit?: number }) {
    const qb = this.signalRepo.createQueryBuilder('s');
    if (opts.subscriptionId) qb.andWhere('s.subscriptionId = :sid', { sid: opts.subscriptionId });
    if (opts.direction) qb.andWhere('s.direction = :dir', { dir: opts.direction });
    if (opts.days) {
      const since = new Date(Date.now() - opts.days * 86400 * 1000).toISOString().slice(0, 10);
      qb.andWhere('s.date >= :since', { since });
    }
    qb.orderBy('s.date', 'DESC').take(opts.limit ?? 100);
    return qb.getMany();
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios from 'axios';
import {
  formatTradeDate,
  MARKET_INDEX_CODE,
  MARKET_INDEX_SECID,
  resolveSecid,
  FundFlowDailyEntity,
  SubscriptionEntity,
  type FundFlowDay,
} from '@fin/core';

/**
 * 资金流采集服务：东方财富 push2his 日K资金流接口（已验证可用）。
 * 字段映射：f52 主力 / f53 小单 / f54 中单 / f55 大单 / f56 超大单 / f57 主力净占比
 *          f62 收盘价 / f63 涨跌幅。独立映射层隔离字段变动风险。
 */
const FLOW_URL = 'https://push2his.eastmoney.com/api/qt/stock/fflow/daykline/get';
const FLOW_UT = 'b2884a393a59ad64002292a3e90d46a5';

@Injectable()
export class FundFlowService {
  private readonly logger = new Logger(FundFlowService.name);
  private readonly http = axios.create({
    timeout: 15000,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      Referer: 'https://quote.eastmoney.com/',
    },
  });

  constructor(
    @InjectRepository(FundFlowDailyEntity)
    private readonly flowRepo: Repository<FundFlowDailyEntity>,
    @InjectRepository(SubscriptionEntity)
    private readonly subRepo: Repository<SubscriptionEntity>,
  ) {}

  /** 拉取某 secid 的日K资金流（默认最近 120 交易日） */
  async fetchDailyKline(secid: string, lmt = 120): Promise<FundFlowDay[]> {
    const resp = await this.http.get(FLOW_URL, {
      params: {
        lmt: 0,
        klt: 101,
        fields1: 'f1,f2,f3,f7',
        fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63',
        secid,
        ut: FLOW_UT,
      },
    });

    const data = resp.data?.data;
    if (!data?.klines || !Array.isArray(data.klines)) {
      throw new Error(`Fund flow API returned no klines for ${secid}`);
    }

    let klines: string[] = data.klines;
    if (klines.length > lmt) klines = klines.slice(-lmt);

    return klines.map((line) => {
      const p = String(line).split(',');
      return {
        date: p[0],
        mainNetInflow: this.num(p[1]),
        smallNetInflow: this.num(p[2]),
        mediumNetInflow: this.num(p[3]),
        largeNetInflow: this.num(p[4]),
        superLargeNetInflow: this.num(p[5]),
        mainNetPct: this.num(p[6]),
        closePrice: this.numOrNull(p[11]),
        changePct: this.numOrNull(p[12]),
      };
    });
  }

  /** 新订阅创建时：回填 120 日历史（接口偶发抖动，重试 3 次） */
  async backfill(sub: SubscriptionEntity): Promise<number> {
    const secid = sub.secid || resolveSecid(sub.code);
    let lastErr: unknown;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const days = await this.fetchDailyKline(secid, 120);
        return await this.upsertRows(sub.code, secid, days);
      } catch (err) {
        lastErr = err;
        this.logger.warn(`[fundflow] backfill ${sub.code} attempt ${attempt} failed: ${err instanceof Error ? err.message : err}`);
        await new Promise((r) => setTimeout(r, 3000 * attempt));
      }
    }
    throw lastErr;
  }

  /** 每交易日收盘后：更新全部启用订阅 + 大盘基准（取最近 5 日补齐当日） */
  async dailyUpdate(): Promise<number> {
    const subs = await this.subRepo.find({ where: { enabled: true } });
    let total = 0;
    for (const sub of subs) {
      try {
        const days = await this.fetchDailyKline(sub.secid || resolveSecid(sub.code), 5);
        total += await this.upsertRows(sub.code, sub.secid || resolveSecid(sub.code), days);
      } catch (err) {
        this.logger.warn(`[fundflow] ${sub.code} ${sub.name} daily update failed: ${err instanceof Error ? err.message : err}`);
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    try {
      const days = await this.fetchDailyKline(MARKET_INDEX_SECID, 5);
      total += await this.upsertRows(MARKET_INDEX_CODE, MARKET_INDEX_SECID, days);
    } catch (err) {
      this.logger.warn(`[fundflow] market index update failed: ${err instanceof Error ? err.message : err}`);
    }
    this.logger.log(`[fundflow] daily update done, ${total} rows upserted for ${subs.length + 1} targets`);
    return total;
  }

  /**
   * 缺口补齐：为没有任何资金流数据的启用订阅做 120 日回填。
   * 由调度器每 30 分钟调用——数据源被限流/断连后，恢复时自动补齐，无需人工干预。
   */
  async backfillMissing(): Promise<number> {
    const subs = await this.subRepo.find({ where: { enabled: true } });
    let fixed = 0;
    for (const sub of subs) {
      const count = await this.flowRepo.count({ where: { code: sub.code } });
      if (count > 0) continue;
      try {
        fixed += await this.backfill(sub);
        this.logger.log(`[fundflow] missing backfilled for ${sub.code} ${sub.name}`);
      } catch (err) {
        this.logger.warn(`[fundflow] missing backfill ${sub.code} failed: ${err instanceof Error ? err.message : err}`);
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    const marketCount = await this.flowRepo.count({ where: { code: MARKET_INDEX_CODE } });
    if (marketCount === 0) {
      try {
        const days = await this.fetchDailyKline(MARKET_INDEX_SECID, 120);
        fixed += await this.upsertRows(MARKET_INDEX_CODE, MARKET_INDEX_SECID, days);
      } catch (err) {
        this.logger.warn(`[fundflow] market index backfill failed: ${err instanceof Error ? err.message : err}`);
      }
    }
    return fixed;
  }

  private async upsertRows(code: string, secid: string, days: FundFlowDay[]): Promise<number> {
    if (days.length === 0) return 0;
    const now = new Date();
    let count = 0;
    for (const day of days) {
      const id = `${code}:${day.date}`;
      const entity = this.flowRepo.create({
        id,
        code,
        secid,
        date: day.date,
        mainNetInflow: day.mainNetInflow,
        superLargeNetInflow: day.superLargeNetInflow,
        largeNetInflow: day.largeNetInflow,
        mediumNetInflow: day.mediumNetInflow,
        smallNetInflow: day.smallNetInflow,
        mainNetPct: day.mainNetPct,
        closePrice: day.closePrice,
        changePct: day.changePct,
        fetchedAt: now,
      });
      try {
        await this.flowRepo.upsert(entity, ['id']);
        count += 1;
      } catch (err) {
        this.logger.warn(`[fundflow] upsert ${id} failed: ${err instanceof Error ? err.message : err}`);
      }
    }
    return count;
  }

  /** 最近交易日（库中有数据的最新日期，供前端展示用） */
  async latestTradeDate(): Promise<string | null> {
    const row = await this.flowRepo
      .createQueryBuilder('f')
      .select('MAX(f.date)', 'maxDate')
      .getRawOne();
    return row?.maxDate ?? formatTradeDate();
  }

  private num(v: string | undefined): number {
    const n = parseFloat(v ?? '');
    return isNaN(n) ? 0 : n;
  }

  private numOrNull(v: string | undefined): number | null {
    const n = parseFloat(v ?? '');
    return isNaN(n) ? null : n;
  }
}

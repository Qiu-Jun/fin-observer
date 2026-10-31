import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CRAWL_DELAY_MS, SubscriptionEntity } from '@fin/core';
import { IngestService } from '../crawlers/ingest.service';
import { FundFlowService } from '../fundflow/fundflow.service';
import { PredictionService } from '../fundflow/prediction.service';

/**
 * 调度器（移植原 CrawlScheduler 的 A 股节奏窗口，改为 @nestjs/schedule cron）：
 * 工作日 08:15/08:45/11:55/12:25 盘前盘中采集，15:10 收盘后采集 + 资金流更新；
 * 非交易日 02:00/04:00 低峰采集；工作日 15:20 计算预测信号。
 * 启动后 8 秒先跑一轮（与原项目一致）。
 */
@Injectable()
export class CrawlerSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(CrawlerSchedulerService.name);
  private running = false;

  constructor(
    private readonly ingest: IngestService,
    private readonly fundFlow: FundFlowService,
    private readonly prediction: PredictionService,
    @InjectRepository(SubscriptionEntity)
    private readonly subRepo: Repository<SubscriptionEntity>,
  ) {}

  onModuleInit(): void {
    // 等待 API 服务（可能同时启动）就绪后再跑第一轮
    setTimeout(() => {
      void this.runAllEnabled().catch((err) => this.logger.error(`Initial crawl failed: ${err?.message}`));
    }, 8000);
  }

  // ── 工作日盘中窗口 ─────────────────────────────────────────────────────────
  @Cron('0 15 8 * * 1-5')
  onCron_0815() { void this.runAllEnabled(); }

  @Cron('0 45 8 * * 1-5')
  onCron_0845() { void this.runAllEnabled(); }

  @Cron('0 55 11 * * 1-5')
  onCron_1155() { void this.runAllEnabled(); }

  @Cron('0 25 12 * * 1-5')
  onCron_1225() { void this.runAllEnabled(); }

  /** 收盘后：内容采集 + 全部订阅资金流日度更新 */
  @Cron('0 10 15 * * 1-5')
  onCron_1510() {
    void (async () => {
      await this.runAllEnabled();
      await this.fundFlow.dailyUpdate();
    })();
  }

  /** 收盘后 10 分钟：预测信号计算 */
  @Cron('0 20 15 * * 1-5')
  onCron_1520() {
    void this.predictionSafe();
  }

  /** 每 30 分钟：为没有资金流数据的订阅补齐回填（数据源限流恢复后自愈） */
  @Cron('0 */30 * * * *')
  onCron_backfillMissing() {
    void (async () => {
      try {
        const fixed = await this.fundFlow.backfillMissing();
        if (fixed > 0) this.logger.log(`[scheduler] fund flow backfilled ${fixed} rows for missing subscriptions`);
      } catch (err) {
        this.logger.error(`[scheduler] backfillMissing failed: ${err instanceof Error ? err.message : err}`);
      }
    })();
  }

  // ── 非交易日低峰窗口 ───────────────────────────────────────────────────────
  @Cron('0 0 2 * * 0,6')
  onCron_weekend02() { void this.runAllEnabled(); }

  @Cron('0 0 4 * * 0,6')
  onCron_weekend04() { void this.runAllEnabled(); }

  // ── 执行逻辑 ───────────────────────────────────────────────────────────────

  async runAllEnabled(): Promise<Array<{ source: string; fetched: number; added: number; success: boolean }>> {
    if (this.running) {
      this.logger.warn('A crawl round is already running, skip');
      return [];
    }
    this.running = true;
    const results: Array<{ source: string; fetched: number; added: number; success: boolean }> = [];

    try {
      // 1) 列表型内容爬虫（串行，间隔 2s）
      for (const crawler of this.ingest.listCrawlers()) {
        if (!crawler.status.enabled) continue;
        try {
          const r = await this.ingest.runCrawler(crawler);
          results.push({ source: crawler.name, ...r, success: true });
        } catch (err) {
          this.logger.error(`[${crawler.name}] run failed: ${err instanceof Error ? err.message : err}`);
          results.push({ source: crawler.name, fetched: 0, added: 0, success: false });
        }
        await new Promise((r) => setTimeout(r, CRAWL_DELAY_MS));
      }

      // 2) 关键字搜索：轮游最多 3 个订阅
      const subs = await this.subRepo.find({ where: { enabled: true } });
      if (subs.length > 0) {
        try {
          const r = await this.ingest.runKeywordSearch(subs, 3);
          results.push({ source: 'keyword-search', ...r, success: true });
        } catch (err) {
          this.logger.error(`[keyword-search] failed: ${err instanceof Error ? err.message : err}`);
          results.push({ source: 'keyword-search', fetched: 0, added: 0, success: false });
        }
      }
    } finally {
      this.running = false;
    }
    return results;
  }

  async runSingle(name: string): Promise<{ source: string; fetched: number; added: number; success: boolean }> {
    const crawler = this.ingest.getCrawler(name);
    if (!crawler) throw new Error(`Crawler not found: ${name}`);
    const r = await this.ingest.runCrawler(crawler);
    return { source: name, ...r, success: true };
  }

  getStatuses() {
    return this.ingest.getStatuses();
  }

  private async predictionSafe(): Promise<void> {
    try {
      const count = await this.prediction.computeAllSignals();
      this.logger.log(`[prediction] ${count} signals computed`);
    } catch (err) {
      this.logger.error(`[prediction] failed: ${err instanceof Error ? err.message : err}`);
    }
  }
}

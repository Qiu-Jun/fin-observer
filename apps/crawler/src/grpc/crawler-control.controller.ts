import { Controller, Inject, Logger } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type {
  CrawlResultSummary,
  CrawlerStatusList,
  GrpcAck,
  RunAllSummary,
  RunCrawlerRequest,
  SubscriptionEvent,
} from '@fin/core';
import { resolveSecid, SubscriptionEntity } from '@fin/core';
import { IngestService } from '../crawlers/ingest.service';
import { CrawlerSchedulerService } from '../scheduler/scheduler.service';
import { FundFlowService } from '../fundflow/fundflow.service';
import { PredictionService } from '../fundflow/prediction.service';

/**
 * gRPC 控制面服务端（CrawlerControl）：
 * api 服务经 gRPC 调用这里完成手动触发、状态拉取与订阅生命周期联动。
 */
@Controller()
export class CrawlerControlController {
  private readonly logger = new Logger(CrawlerControlController.name);

  constructor(
    private readonly scheduler: CrawlerSchedulerService,
    private readonly ingest: IngestService,
    private readonly fundFlow: FundFlowService,
    private readonly prediction: PredictionService,
    @InjectRepository(SubscriptionEntity)
    private readonly subRepo: Repository<SubscriptionEntity>,
  ) {}

  @GrpcMethod('CrawlerControl', 'RunCrawler')
  async runCrawler(request: RunCrawlerRequest): Promise<CrawlResultSummary> {
    this.logger.log(`[grpc] RunCrawler: ${request.name}`);
    // 特例：手动触发资金流日度更新（全部启用订阅 + 大盘）
    if (request.name === 'fund-flow') {
      try {
        const rows = await this.fundFlow.dailyUpdate();
        return { source: 'fund-flow', fetched: rows, added: rows, success: true, error: '', durationMs: 0 };
      } catch (err) {
        return { source: 'fund-flow', fetched: 0, added: 0, success: false, error: err instanceof Error ? err.message : String(err), durationMs: 0 };
      }
    }
    try {
      const r = await this.scheduler.runSingle(request.name);
      return { source: r.source, fetched: r.fetched, added: r.added, success: r.success, error: '', durationMs: 0 };
    } catch (err) {
      return { source: request.name, fetched: 0, added: 0, success: false, error: err instanceof Error ? err.message : String(err), durationMs: 0 };
    }
  }

  @GrpcMethod('CrawlerControl', 'RunAllCrawlers')
  async runAll(): Promise<RunAllSummary> {
    this.logger.log('[grpc] RunAllCrawlers');
    const results = await this.scheduler.runAllEnabled();
    return {
      results: results.map((r) => ({
        source: r.source,
        fetched: r.fetched,
        added: r.added,
        success: r.success,
        error: '',
        durationMs: 0,
      })),
    };
  }

  @GrpcMethod('CrawlerControl', 'GetCrawlerStatuses')
  getStatuses(): CrawlerStatusList {
    const statuses = this.scheduler.getStatuses();
    return {
      statuses: statuses.map((s) => ({
        name: s.name,
        sourceName: s.sourceName,
        sourceType: s.sourceType,
        enabled: s.enabled,
        isRunning: s.isRunning,
        lastSuccess: s.lastSuccess,
        lastError: s.lastError ?? '',
        lastCrawlAt: s.lastCrawlAt ?? '',
        lastItemAt: s.lastItemAt ?? '',
        totalFetched: s.totalFetched,
        consecutiveFailures: s.consecutiveFailures,
        circuitOpen: s.circuitOpen,
        healthScore: s.healthScore,
      })),
    };
  }

  @GrpcMethod('CrawlerControl', 'OnSubscriptionChanged')
  async onSubscriptionChanged(event: SubscriptionEvent): Promise<GrpcAck> {
    this.logger.log(`[grpc] OnSubscriptionChanged: ${event.action} ${event.code} ${event.name}`);
    try {
      if (event.action === 'created') {
        // 1) 回填 120 日资金流历史
        const sub = new SubscriptionEntity();
        sub.id = event.subscriptionId;
        sub.type = event.type as SubscriptionEntity['type'];
        sub.code = event.code;
        sub.name = event.name;
        sub.secid = event.secid || resolveSecid(event.code);
        sub.aliases = event.aliasesJson ? JSON.parse(event.aliasesJson) : null;
        sub.createdAt = new Date();
        sub.updatedAt = new Date();
        const backfilled = await this.fundFlow.backfill(sub);
        this.logger.log(`[grpc] backfilled ${backfilled} flow rows for ${event.code}`);
        // 2) 立即按该订阅关键词定向采集一轮
        const r = await this.ingest.runKeywordSearch([sub], 3);
        this.logger.log(`[grpc] keyword search for ${event.code}: fetched ${r.fetched}, added ${r.added}`);
        return { ok: true, message: `backfilled ${backfilled} rows, searched ${r.fetched} items` };
      }
      // updated/deleted：词表在每轮运行前重新加载，无需额外动作
      return { ok: true, message: 'acknowledged' };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`[grpc] OnSubscriptionChanged failed: ${message}`);
      return { ok: false, message };
    }
  }

  @GrpcMethod('CrawlerControl', 'ComputeSignals')
  async computeSignals(): Promise<GrpcAck> {
    this.logger.log('[grpc] ComputeSignals');
    try {
      const count = await this.prediction.computeAllSignals();
      return { ok: true, message: `${count} signals computed` };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }
}

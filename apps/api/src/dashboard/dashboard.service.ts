import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThanOrEqual } from 'typeorm';
import { AlertEntity, ContentEntity, FundFlowSignalEntity } from '@fin/core';
import { CrawlerControlClientService } from '../grpc/crawler-control.client';
import { TemperatureService } from '../temperature/temperature.service';
import type { GrpcCrawlerStatus } from '@fin/core';

/** 工作台聚合接口（一次请求出全部看板数据） */
@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(AlertEntity) private readonly alertRepo: Repository<AlertEntity>,
    @InjectRepository(ContentEntity) private readonly contentRepo: Repository<ContentEntity>,
    @InjectRepository(FundFlowSignalEntity) private readonly signalRepo: Repository<FundFlowSignalEntity>,
    private readonly temperature: TemperatureService,
    private readonly crawlerClient: CrawlerControlClientService,
  ) {}

  async summary() {
    const since24h = new Date(Date.now() - 24 * 3600 * 1000);

    const [pendingAlerts, criticalAlerts, contents24h, heat, latestSignals, recentContents, statuses] =
      await Promise.all([
        this.alertRepo.count({ where: { status: 'pending' } }),
        this.alertRepo
          .createQueryBuilder('a')
          .where('a.status IN (:...st)', { st: ['pending', 'processing'] })
          .andWhere('a.riskLevel IN (:...rl)', { rl: ['high', 'critical'] })
          .getCount(),
        this.contentRepo.count({ where: { publishedAt: MoreThanOrEqual(since24h) } }),
        this.temperature.computeAll(),
        this.signalRepo.find({ order: { date: 'DESC', strength: 'DESC' }, take: 10 }),
        this.contentRepo.find({ order: { publishedAt: 'DESC' }, take: 10 }),
        this.crawlerClient.tryCall((c) => c.GetCrawlerStatuses({}), { statuses: [] as GrpcCrawlerStatus[] }),
      ]);

    const sentiment24h = { positive: 0, neutral: 0, negative: 0 };
    const recent = await this.contentRepo.find({
      select: ['id', 'nlp', 'publishedAt'],
      where: { publishedAt: MoreThanOrEqual(since24h) },
    });
    for (const c of recent) {
      const label = c.nlp?.sentimentLabel ?? 'neutral';
      sentiment24h[label] = (sentiment24h[label] ?? 0) + 1;
    }

    const crawlOk = statuses.statuses.filter((s) => s.enabled && s.healthScore >= 75).length;
    const crawlBad = statuses.statuses.filter((s) => s.enabled && s.healthScore < 75).length;

    return {
      alerts: { pending: pendingAlerts, critical: criticalAlerts },
      contents24h,
      sentiment24h,
      heatTop5: heat.slice(0, 5),
      latestSignals,
      recentContents,
      crawlHealth: { ok: crawlOk, bad: crawlBad, statuses: statuses.statuses },
    };
  }
}

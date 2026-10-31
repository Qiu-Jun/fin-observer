import { Controller, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CrawlLogEntity } from '@fin/core';
import { CrawlerControlClientService } from '../grpc/crawler-control.client';

/** 爬虫管理：日志走共享库，触发与实时状态经 gRPC 到 crawler 服务 */
@Controller('crawlers')
export class CrawlersController {
  constructor(
    private readonly crawlerClient: CrawlerControlClientService,
    @InjectRepository(CrawlLogEntity) private readonly logRepo: Repository<CrawlLogEntity>,
  ) {}

  @Get('status')
  status() {
    return this.crawlerClient.tryCall((c) => c.GetCrawlerStatuses({}), { statuses: [] }).then((r) => r.statuses);
  }

  @Get('logs')
  async logs() {
    return this.logRepo.find({ order: { crawledAt: 'DESC' }, take: 50 });
  }

  @Post('run-all')
  runAll() {
    return this.crawlerClient.tryCall((c) => c.RunAllCrawlers({}), { results: [] });
  }

  @Post('compute-signals')
  computeSignals() {
    return this.crawlerClient.tryCall((c) => c.ComputeSignals({}), { ok: false, message: 'crawler unavailable' });
  }

  @Post(':name/run')
  run(@Param('name') name: string) {
    if (!name) throw new NotFoundException('Crawler name required');
    return this.crawlerClient.tryCall((c) => c.RunCrawler({ name }), {
      source: name,
      fetched: 0,
      added: 0,
      success: false,
      error: 'crawler service unavailable',
      durationMs: 0,
    });
  }
}

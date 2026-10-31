import { Module, Provider } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import axios, { type AxiosInstance } from 'axios';
import { SubscriptionEntity } from '@fin/core';
import { CRAWLER_HTTP, CRAWLER_REGISTRY } from './crawlers.constants';
import { EastMoneyCrawler } from './sources/eastmoney.crawler';
import { SinaCrawler } from './sources/sina.crawler';
import { YicaiCrawler } from './sources/yicai.crawler';
import { ThsCrawler } from './sources/ths.crawler';
import { XueqiuCrawler } from './sources/xueqiu.crawler';
import { KeywordSearchService } from './keyword-search.service';
import { IngestService } from './ingest.service';
import { StorageModule } from '../storage/storage.module';
import { FundflowModule } from '../fundflow/fundflow.module';
import { CrawlerSchedulerService } from '../scheduler/scheduler.service';

const crawlerHttpProvider: Provider = {
  provide: CRAWLER_HTTP,
  useFactory: () =>
    axios.create({
      timeout: 15000,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
    }),
};

const registryProvider: Provider = {
  provide: CRAWLER_REGISTRY,
  inject: [CRAWLER_HTTP],
  useFactory: (http: AxiosInstance) => [
    new EastMoneyCrawler(http),
    new SinaCrawler(http),
    new YicaiCrawler(http),
    new ThsCrawler(http),
    new XueqiuCrawler(http),
  ],
};

@Module({
  imports: [StorageModule, FundflowModule, TypeOrmModule.forFeature([SubscriptionEntity])],
  providers: [crawlerHttpProvider, registryProvider, KeywordSearchService, IngestService, CrawlerSchedulerService],
  exports: [CRAWLER_REGISTRY, IngestService, KeywordSearchService, CrawlerSchedulerService, FundflowModule],
})
export class CrawlerModule {}

import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  analyzeSentimentBatch,
  buildSubscriptionTerms,
  isLlmEnabled,
  matchSubscriptions,
  recognizeEvents,
  toBaseSentimentLabel,
  SubscriptionEntity,
  type ContentItem,
  type SubscriptionLexicon,
} from '@fin/core';
import { CRAWLER_REGISTRY } from './crawlers.constants';
import { BaseCrawler } from './base.crawler';
import { KeywordSearchService } from './keyword-search.service';
import { StorageService } from '../storage/storage.service';

/**
 * 入库管线：爬取 → LLM 前去重 → 订阅匹配（相关度评分）→ 事件识别 → LLM 增强情绪 → 入库 → 日志。
 * matches 在此写入（原项目从不写该字段的改进点）。
 */
@Injectable()
export class IngestService {
  private readonly logger = new Logger(IngestService.name);

  constructor(
    @Inject(CRAWLER_REGISTRY) private readonly registry: BaseCrawler[],
    private readonly storage: StorageService,
    private readonly keywordSearch: KeywordSearchService,
    @InjectRepository(SubscriptionEntity)
    private readonly subRepo: Repository<SubscriptionEntity>,
  ) {}

  async loadLexicons(): Promise<Array<{ sub: SubscriptionLexicon; terms: string[] }>> {
    const subs = await this.subRepo.find({ where: { enabled: true } });
    return subs.map((sub) => {
      const lex: SubscriptionLexicon = {
        id: sub.id,
        name: sub.name,
        code: sub.code,
        type: sub.type,
        aliases: sub.aliases ?? [],
      };
      return { sub: lex, terms: buildSubscriptionTerms(lex) };
    });
  }

  private extraSubjects(lexicons: Array<{ sub: SubscriptionLexicon; terms: string[] }>): string[] {
    const names = lexicons.flatMap(({ sub }) => [sub.name, ...(sub.aliases ?? [])]);
    return [...new Set(names)].filter((n) => n && n.length >= 2);
  }

  /** 运行单个内容爬虫并完成全管线入库，返回入库条数 */
  async runCrawler(crawler: BaseCrawler): Promise<{ fetched: number; added: number }> {
    const result = await crawler.crawl();
    if (!result.success) {
      await this.storage.appendCrawlLog({
        source: crawler.name,
        itemsFetched: 0,
        itemsAdded: 0,
        success: false,
        duration: result.duration,
        error: result.error,
      });
      return { fetched: 0, added: 0 };
    }

    // LLM 前去重：已入库内容（id + url）不再做增强分析
    const newItems = await this.storage.filterFresh(result.items);
    const added = await this.enrichAndStore(newItems, crawler.name);
    return { fetched: result.items.length, added };
  }

  /** 运行关键字搜索并把结果并入管线（搜索结果自带 matches，仅做事件识别与情绪增强） */
  async runKeywordSearch(subs: SubscriptionEntity[], take = 3): Promise<{ fetched: number; added: number }> {
    const items = await this.keywordSearch.searchRoundRobin(subs, take);
    const fresh = await this.storage.filterFresh(items);
    const added = await this.enrichAndStore(fresh, 'keyword-search');
    return { fetched: items.length, added };
  }

  private async enrichAndStore(items: ContentItem[], source: string): Promise<number> {
    if (items.length === 0) {
      await this.storage.appendCrawlLog({ source, itemsFetched: 0, itemsAdded: 0, success: true, duration: 0 });
      return 0;
    }
    const start = Date.now();
    const lexicons = await this.loadLexicons();
    const subjects = this.extraSubjects(lexicons);

    // 1) 订阅匹配（相关度评分写 matches）
    for (const item of items) {
      item.matches = matchSubscriptions(
        {
          title: item.title,
          content: item.content,
          entityNames: (item.nlp.entities ?? []).map((e) => e.name),
        },
        lexicons,
      );
    }

    // 2) 结构化事件识别（T012 词表 + 订阅主体）
    for (const item of items) {
      const events = recognizeEvents(`${item.title} ${item.content}`, subjects);
      if (events.length > 0) item.nlp.events = events;
    }

    // 3) LLM 增强情绪：仅对命中订阅的内容调用（成本漏斗），其余保留词典结果
    const candidates = items.filter((it) => it.matches.length > 0);
    if (candidates.length > 0) {
      if (isLlmEnabled()) {
        this.logger.log(`[${source}] ${candidates.length}/${items.length} matched items → LLM batch analysis`);
      }
      const results = await analyzeSentimentBatch(
        candidates.map((it) => ({ text: `${it.title} ${it.content}`, sourceType: it.sourceType })),
      );
      for (let i = 0; i < candidates.length; i++) {
        const r = results[i];
        if (!r) continue;
        candidates[i].nlp.enhanced = {
          label: r.label,
          confidence: r.confidence,
          reasoning: r.reasoning,
          modelSource: r.modelSource,
          positiveSignals: r.positiveSignals,
          negativeSignals: r.negativeSignals,
          riskSignals: r.riskSignals,
          rumorSignals: r.rumorSignals,
        };
        candidates[i].nlp.sentimentLabel = toBaseSentimentLabel(r.label);
      }
    }

    const added = await this.storage.addItems(items);
    await this.storage.appendCrawlLog({
      source,
      itemsFetched: items.length,
      itemsAdded: added,
      success: true,
      duration: Date.now() - start,
    });
    this.logger.log(`[${source}] fetched ${items.length}, added ${added} (${Date.now() - start}ms)`);
    return added;
  }

  getStatuses() {
    return this.registry.map((c) => ({ ...c.status }));
  }

  listCrawlers(): BaseCrawler[] {
    return this.registry;
  }

  getCrawler(name: string): BaseCrawler | undefined {
    return this.registry.find((c) => c.name === name);
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { v4 as uuid } from 'uuid';
import { ContentEntity, CrawlLogEntity, dedupeByIdUrl, type ContentItem } from '@fin/core';

/**
 * 内容入库：id + 非空 url 双重去重（替代原 INSERT OR IGNORE 语义），
 * 以及爬取日志写入。
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);

  constructor(
    @InjectRepository(ContentEntity)
    private readonly contentRepo: Repository<ContentEntity>,
    @InjectRepository(CrawlLogEntity)
    private readonly logRepo: Repository<CrawlLogEntity>,
  ) {}

  /** 已知内容 ID 集合（LLM 前去重用） */
  async getKnownIds(): Promise<Set<string>> {
    const rows = await this.contentRepo.find({ select: { id: true } });
    return new Set(rows.map((r) => r.id));
  }

  private async getExistingUrls(urls: string[]): Promise<Set<string>> {
    if (urls.length === 0) return new Set();
    const found = new Set<string>();
    for (let i = 0; i < urls.length; i += 100) {
      const chunk = urls.slice(i, i + 100);
      const rows = await this.contentRepo.find({
        select: { url: true },
        where: { url: In(chunk) },
      });
      for (const r of rows) if (r.url) found.add(r.url);
    }
    return found;
  }

  /**
   * 过滤出库中不存在的内容（id + 非空 url 双重比对）。
   * 供入库管线在 LLM 分析之前调用，避免对重复内容浪费模型调用。
   */
  async filterFresh(items: ContentItem[]): Promise<ContentItem[]> {
    if (items.length === 0) return [];
    const knownIds = await this.getKnownIds();
    const urls = items.map((it) => it.url?.trim()).filter((u): u is string => !!u);
    const knownUrls = await this.getExistingUrls(urls);
    return items.filter(
      (it) => !knownIds.has(it.id) && !(it.url?.trim() && knownUrls.has(it.url.trim())),
    );
  }

  /**
   * 入库一批内容，返回新增条数。
   * 去重链：内存 id/url 去重 → 与库中 id/url 比对 → 逐条插入（冲突跳过）。
   */
  async addItems(items: ContentItem[]): Promise<number> {
    if (items.length === 0) return 0;

    // 第一步：批内去重
    const unique = dedupeByIdUrl(items);

    // 第二步：与库中已有数据比对（id + url）
    const fresh = await this.filterFresh(unique);
    const skipped = unique.length - fresh.length;
    if (skipped > 0) this.logger.log(`Skipped ${skipped} duplicated items`);

    // 第三步：插入
    let added = 0;
    for (const item of fresh) {
      try {
        await this.contentRepo.insert(this.toEntity(item));
        added += 1;
      } catch (err) {
        // 主键/唯一冲突等 → 跳过该条
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes('UNIQUE')) this.logger.warn(`Insert failed: ${msg}`);
      }
    }
    return added;
  }

  private toEntity(item: ContentItem): ContentEntity {
    const e = new ContentEntity();
    e.id = item.id;
    e.title = item.title.slice(0, 512);
    e.content = item.content ?? '';
    e.sourceType = item.sourceType;
    e.sourceName = item.sourceName;
    e.author = item.author ?? null;
    e.url = item.url ?? null;
    e.publishedAt = new Date(item.publishedAt || item.fetchedAt || Date.now());
    e.fetchedAt = new Date(item.fetchedAt || Date.now());
    e.market = item.market;
    e.metrics = item.metrics ?? null;
    e.matches = item.matches ?? null;
    e.nlp = item.nlp;
    e.dedup = item.dedup ?? null;
    return e;
  }

  async appendCrawlLog(entry: {
    source: string;
    itemsFetched: number;
    itemsAdded: number;
    success: boolean;
    duration: number;
    error?: string;
  }): Promise<void> {
    try {
      await this.logRepo.insert({
        id: uuid(),
        source: entry.source,
        crawledAt: new Date(),
        itemsFetched: entry.itemsFetched,
        itemsAdded: entry.itemsAdded,
        success: entry.success,
        duration: entry.duration,
        error: entry.error ?? null,
      });
    } catch (err) {
      this.logger.warn(`Failed to append crawl log: ${err instanceof Error ? err.message : err}`);
    }
  }
}

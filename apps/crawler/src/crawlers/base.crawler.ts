import type { AxiosInstance } from 'axios';
import { v4 as uuid } from 'uuid';
import {
  CRAWL_DELAY_MS,
  DEFAULT_CRAWLER_CONFIG,
  analyzeSentiment,
  stripHtml,
  type ContentItem,
  type CrawlerConfig,
  type CrawlResult,
  type CrawlerStatus,
  type MarketType,
  type SourceType,
} from '@fin/core';

/** 爬虫抓取的原始条目（入库前由管线补全 id/时间/情绪/匹配） */
export interface RawItem {
  title: string;
  content?: string;
  sourceName?: string;
  author?: string;
  url?: string;
  publishedAt?: string; // ISO 字符串或 ''
  metrics?: { likes?: number; comments?: number; shares?: number; views?: number };
}

export interface BaseCrawlerOptions {
  name: string;
  sourceName: string;
  sourceType: SourceType;
  market?: MarketType;
  http: AxiosInstance;
  configOverrides?: Partial<CrawlerConfig>;
}

/**
 * 爬虫抽象基类（移植原 BaseCrawler 生命周期，去 Nest 化为普通类以便脚本复用）：
 * 子类只实现 doFetch()，基类统一处理 重试/熔断/健康分/基础情绪富化。
 */
export abstract class BaseCrawler {
  readonly name: string;
  readonly sourceName: string;
  readonly sourceType: SourceType;
  readonly market: MarketType;
  protected config: CrawlerConfig;
  protected http: AxiosInstance;
  status: CrawlerStatus;

  constructor(opts: BaseCrawlerOptions) {
    this.name = opts.name;
    this.sourceName = opts.sourceName;
    this.sourceType = opts.sourceType;
    this.market = opts.market ?? 'cn';
    this.config = { ...DEFAULT_CRAWLER_CONFIG, ...opts.configOverrides };
    this.http = opts.http;
    this.status = {
      name: this.name,
      sourceName: this.sourceName,
      sourceType: this.sourceType,
      enabled: this.config.enabled,
      lastSuccess: true,
      totalFetched: 0,
      totalAttempts: 0,
      isRunning: false,
      consecutiveFailures: 0,
      circuitOpen: false,
      healthScore: 100,
    };
  }

  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
    this.status.enabled = enabled;
  }

  async crawl(): Promise<CrawlResult> {
    if (!this.config.enabled) {
      return { source: this.name, items: [], fetchedAt: new Date().toISOString(), success: false, error: 'Crawler is disabled', duration: 0 };
    }

    // 熔断检查
    if (this.status.circuitOpen) {
      const until = this.status.circuitOpenUntil;
      if (until && new Date(until) > new Date()) {
        return { source: this.name, items: [], fetchedAt: new Date().toISOString(), success: false, error: `Circuit open until ${until}`, duration: 0 };
      }
      this.status.circuitOpen = false;
      this.status.circuitOpenUntil = undefined;
      console.log(`[${this.name}] Circuit closed after backoff, retrying...`);
    }

    this.status.isRunning = true;
    this.status.totalAttempts += 1;
    const start = Date.now();
    const fetchedAt = new Date().toISOString();

    try {
      const rawItems = await this.fetchWithRetry();
      const items = rawItems.map((raw) => this.enrichItem(raw, fetchedAt));

      this.status.lastCrawlAt = fetchedAt;
      this.status.lastSuccess = true;
      this.status.lastError = undefined;
      this.status.consecutiveFailures = 0;
      this.status.totalFetched += items.length;

      const newestAt = items.reduce((latest, item) => {
        const t = item.publishedAt || item.fetchedAt || '';
        return t > latest ? t : latest;
      }, '');
      if (newestAt) this.status.lastItemAt = newestAt;

      this.status.healthScore = this.calculateHealthScore();
      return { source: this.name, items, fetchedAt, success: true, duration: Date.now() - start };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.status.lastCrawlAt = fetchedAt;
      this.status.lastSuccess = false;
      this.status.lastError = errorMsg;
      this.status.consecutiveFailures += 1;

      const threshold = this.config.circuitBreakerThreshold;
      if (this.status.consecutiveFailures >= threshold) {
        this.status.circuitOpen = true;
        this.status.circuitOpenUntil = new Date(Date.now() + this.config.backoffMinutes * 60 * 1000).toISOString();
        console.warn(`[${this.name}] Circuit opened after ${this.status.consecutiveFailures} failures, retry after ${this.config.backoffMinutes}min`);
      }

      this.status.healthScore = this.calculateHealthScore();
      console.error(`[${this.name}] Crawl failed:`, errorMsg);
      return { source: this.name, items: [], fetchedAt, success: false, error: errorMsg, duration: Date.now() - start };
    } finally {
      this.status.isRunning = false;
    }
  }

  private calculateHealthScore(): number {
    if (this.status.circuitOpen) return 0;
    const penalty = Math.min(100, this.status.consecutiveFailures * 25);
    return Math.max(0, 100 - penalty);
  }

  private async fetchWithRetry(): Promise<RawItem[]> {
    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= this.config.retries; attempt++) {
      try {
        if (attempt > 0) {
          await this.delay(CRAWL_DELAY_MS * attempt);
          console.log(`[${this.name}] Retry attempt ${attempt}...`);
        }
        return await this.doFetch();
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }
    throw lastError;
  }

  protected abstract doFetch(): Promise<RawItem[]>;

  private enrichItem(raw: RawItem, fetchedAt: string): ContentItem {
    const title = (raw.title ?? '').trim();
    const content = stripHtml(raw.content && raw.content !== title ? raw.content : title);
    const text = `${title} ${content}`;
    const nlpResult = analyzeSentiment(text);

    return {
      id: uuid(),
      title: title.slice(0, 500),
      content,
      sourceType: this.sourceType,
      sourceName: raw.sourceName || this.sourceName,
      author: raw.author,
      url: raw.url,
      publishedAt: raw.publishedAt || fetchedAt,
      fetchedAt,
      market: this.market,
      metrics: raw.metrics ?? {},
      matches: [],
      nlp: {
        sentiment: nlpResult.score,
        sentimentLabel: nlpResult.label,
        riskLevel: nlpResult.riskLevel,
        summary: title,
        entities: nlpResult.entities,
      },
      dedup: { clusterId: '', similarCount: 0 },
    };
  }

  protected delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  protected parseTime(timeStr?: string | number | null): string {
    if (!timeStr) return '';
    try {
      if (typeof timeStr === 'number' || /^\d+$/.test(String(timeStr))) {
        const ts = typeof timeStr === 'number' ? timeStr : parseInt(timeStr, 10);
        const d = new Date(String(timeStr).length === 10 ? ts * 1000 : ts);
        return isNaN(d.getTime()) ? '' : d.toISOString();
      }
      const d = new Date(String(timeStr).replace(/-/g, '/'));
      return isNaN(d.getTime()) ? '' : d.toISOString();
    } catch {
      return '';
    }
  }
}

import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AxiosInstance } from 'axios';
import { decodeHtmlBuffer, stripHtml, type ContentItem, type SubscriptionEntity } from '@fin/core';
import { CRAWLER_HTTP } from './crawlers.constants';

/**
 * 关键字搜索爬虫：按订阅词表调用东方财富站内搜索接口（JSONP，GBK 编码）。
 * 与列表型爬虫互补——列表爬虫负责大盘资讯，本服务负责"订阅相关"的定向采集。
 * 搜索结果直接携带订阅匹配记录，是 matches 的重要来源。
 */
@Injectable()
export class KeywordSearchService {
  private readonly logger = new Logger(KeywordSearchService.name);
  /** 轮游游标：每次调度窗口推进，避免每次都搜同几个订阅 */
  private cursor = 0;

  constructor(@Inject(CRAWLER_HTTP) private readonly http: AxiosInstance) {}

  /** 搜索单个订阅（最多 maxTerms 个关键词） */
  async searchSubscription(
    sub: SubscriptionEntity,
    maxTerms = 3,
  ): Promise<{ items: ContentItem[]; keywordHits: Record<string, number> }> {
    const terms = [sub.name, ...(sub.aliases ?? [])].map((t) => t?.trim()).filter((t) => t && t.length >= 2);
    const keywords = [...new Set(terms)].slice(0, maxTerms);
    const items: ContentItem[] = [];
    const keywordHits: Record<string, number> = {};

    for (const keyword of keywords) {
      try {
        const results = await this.searchOnce(keyword, 10);
        keywordHits[keyword] = results.length;
        for (const r of results) {
          items.push({
            id: `${sub.id}-${this.hashUrl(r.url)}-${Date.now()}`.slice(0, 60) + Math.random().toString(36).slice(2, 6),
            title: r.title,
            content: r.content,
            sourceType: 'news',
            sourceName: r.mediaName || '东财搜索',
            author: r.mediaName,
            url: r.url,
            publishedAt: r.publishedAt,
            fetchedAt: new Date().toISOString(),
            market: 'cn',
            metrics: {},
            matches: [
              {
                subscriptionId: sub.id,
                keyword,
                score: 60,
                isCoreSubject: true,
                isMentionOnly: false,
              },
            ],
            nlp: {
              sentiment: 0,
              sentimentLabel: 'neutral',
              riskLevel: 'low',
              summary: r.title,
              entities: [],
            },
            dedup: { clusterId: '', similarCount: 0 },
          });
        }
        await this.delay(1200);
      } catch (err) {
        this.logger.warn(`Search "${keyword}" failed: ${err instanceof Error ? err.message : err}`);
      }
    }
    return { items, keywordHits };
  }

  /** 调度窗口内轮询式搜索多个订阅（每次最多 take 个） */
  async searchRoundRobin(subs: SubscriptionEntity[], take = 3): Promise<ContentItem[]> {
    if (subs.length === 0) return [];
    const all: ContentItem[] = [];
    for (let i = 0; i < Math.min(take, subs.length); i++) {
      const sub = subs[this.cursor % subs.length];
      this.cursor += 1;
      const { items } = await this.searchSubscription(sub);
      all.push(...items);
    }
    return all;
  }

  private async searchOnce(keyword: string, pageSize: number): Promise<Array<{ title: string; content: string; mediaName: string; url: string; publishedAt: string }>> {
    const param = JSON.stringify({
      uid: '',
      keyword,
      type: ['cmsArticleWebOld'],
      client: 'web',
      clientType: 'web',
      clientVersion: 'curr',
      param: {
        cmsArticleWebOld: {
          searchScope: 'default',
          sort: 'time',
          pageIndex: 1,
          pageSize,
          preTag: '<em>',
          postTag: '</em>',
        },
      },
    });
    const cb = `jQuery_${Date.now()}`;
    const resp = await this.http.get(
      `https://search-api-web.eastmoney.com/search/jsonp?cb=${cb}&param=${encodeURIComponent(param)}`,
      { responseType: 'arraybuffer', headers: { Referer: 'https://so.eastmoney.com/' } },
    );
    const text = decodeHtmlBuffer(resp.data as ArrayBuffer);
    const json = JSON.parse(text.replace(new RegExp(`^${cb}\\(`), '').replace(/\);?\s*$/, ''));
    const list = json?.result?.cmsArticleWebOld ?? [];

    return list.map((item: any) => ({
      title: stripHtml(item.title || ''),
      content: stripHtml(item.content || '').slice(0, 500),
      mediaName: item.mediaName || '',
      url: item.url || '',
      publishedAt: this.parseDate(item.date),
    })).filter((it: any) => it.title && it.url);
  }

  private parseDate(dateStr?: string): string {
    if (!dateStr) return new Date().toISOString();
    try {
      const d = new Date(dateStr.replace(/-/g, '/'));
      return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
    } catch {
      return new Date().toISOString();
    }
  }

  private hashUrl(url: string): string {
    let hash = 5381;
    for (let i = 0; i < url.length; i++) hash = ((hash << 5) + hash + url.charCodeAt(i)) | 0;
    return Math.abs(hash).toString(36);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

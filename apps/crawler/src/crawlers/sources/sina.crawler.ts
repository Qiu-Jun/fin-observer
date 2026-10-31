import type { AxiosInstance } from 'axios';
import type { CrawlerConfig } from '@fin/core';
import { BaseCrawler, type RawItem } from '../base.crawler';

/** 新浪财经滚动新闻爬虫（移植原实现） */
export class SinaCrawler extends BaseCrawler {
  constructor(http: AxiosInstance, overrides?: Partial<CrawlerConfig>) {
    super({
      name: 'sina_finance',
      sourceName: '新浪财经',
      sourceType: 'news',
      http,
      configOverrides: { intervalMinutes: 10, ...overrides },
    });
  }

  protected async doFetch(): Promise<RawItem[]> {
    const allItems: RawItem[] = [];

    for (let page = 1; page <= this.config.maxPages; page++) {
      if (page > 1) await this.delay(2000);
      try {
        const resp = await this.http.get('https://feed.mix.sina.com.cn/api/roll/get', {
          params: { pageid: '153', lid: '2516', k: '', num: this.config.pageSize, page },
          headers: { Referer: 'https://finance.sina.com.cn/' },
        });

        const data = resp.data?.result?.data;
        if (!Array.isArray(data) || data.length === 0) break;

        for (const item of data) {
          allItems.push({
            title: item.title || '',
            content: item.intro || item.summary || item.title || '',
            sourceName: item.media_name || '新浪财经',
            author: item.author || item.media_name || '新浪财经',
            url: item.url || '',
            publishedAt: this.parseTime(item.ctime || item.intime),
            metrics: { comments: item.comment_count || 0 },
          });
        }
        console.log(`[sina_finance] Page ${page}: fetched ${data.length} items`);
      } catch (err) {
        console.error(`[sina_finance] Page ${page} failed:`, (err as Error).message);
        break;
      }
    }
    return allItems;
  }
}

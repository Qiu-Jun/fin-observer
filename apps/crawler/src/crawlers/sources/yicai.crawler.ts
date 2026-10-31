import type { AxiosInstance } from 'axios';
import type { CrawlerConfig } from '@fin/core';
import { BaseCrawler, type RawItem } from '../base.crawler';

/** 第一财经快讯爬虫（移植原 cls/yicai 实现） */
export class YicaiCrawler extends BaseCrawler {
  constructor(http: AxiosInstance, overrides?: Partial<CrawlerConfig>) {
    super({
      name: 'yicai',
      sourceName: '第一财经',
      sourceType: 'news',
      http,
      configOverrides: { intervalMinutes: 10, pageSize: 30, ...overrides },
    });
  }

  protected async doFetch(): Promise<RawItem[]> {
    const allItems: RawItem[] = [];

    for (let page = 1; page <= this.config.maxPages; page++) {
      if (page > 1) await this.delay(2000);
      try {
        const resp = await this.http.get('https://www.yicai.com/api/ajax/getlatest', {
          params: { page, pagesize: this.config.pageSize },
          headers: { Referer: 'https://www.yicai.com/' },
        });

        const data = resp.data;
        if (!Array.isArray(data) || data.length === 0) break;

        for (const item of data) {
          allItems.push({
            title: item.NewsTitle || '',
            content: item.NewsContent || item.NewsSummary || item.NewsTitle || '',
            sourceName: '第一财经',
            author: item.NewsAuthor || item.CreaterName || '第一财经',
            url: item.NewsID ? `https://www.yicai.com/news/${item.NewsID}` : 'https://www.yicai.com/',
            publishedAt: this.parseTime(item.CreateDate || ''),
            metrics: { comments: item.CommentCount || 0 },
          });
        }
        console.log(`[yicai] Page ${page}: fetched ${data.length} items`);
      } catch (err) {
        console.error(`[yicai] Page ${page} failed:`, (err as Error).message);
        break;
      }
    }
    return allItems;
  }
}

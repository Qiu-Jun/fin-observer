import type { AxiosInstance } from 'axios';
import { decodeHtmlBuffer, type CrawlerConfig } from '@fin/core';
import { BaseCrawler, type RawItem } from '../base.crawler';

/** 东方财富快讯/新闻爬虫（移植原实现：主 API + GBK 编码的 fallback 接口） */
export class EastMoneyCrawler extends BaseCrawler {
  constructor(http: AxiosInstance, overrides?: Partial<CrawlerConfig>) {
    super({
      name: 'eastmoney',
      sourceName: '东方财富',
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
        const resp = await this.http.get('https://np-listapi.eastmoney.com/comm/web/getNewsByColumns', {
          params: {
            client: 'web',
            biz: 'web_news_col',
            column: '102',
            order: '1',
            needInteractData: '0',
            page_index: page,
            page_size: this.config.pageSize,
          },
          headers: { Referer: 'https://www.eastmoney.com/' },
        });

        let data = resp.data?.data?.list;
        if (!data) data = resp.data?.data;
        if (!Array.isArray(data) || data.length === 0) {
          if (page === 1) return await this.fetchFallback();
          break;
        }

        for (const item of data) allItems.push(this.mapItem(item));
        console.log(`[eastmoney] Page ${page}: fetched ${data.length} items`);
      } catch (err) {
        console.error(`[eastmoney] Page ${page} failed:`, (err as Error).message);
        if (page === 1) return await this.fetchFallback();
        break;
      }
    }
    return allItems;
  }

  private async fetchFallback(): Promise<RawItem[]> {
    try {
      const resp = await this.http.get('https://newsapi.eastmoney.com/kuaixun/v1/getlist_102_ajaxResult_50_1_.html', {
        headers: { Referer: 'https://www.eastmoney.com/' },
        responseType: 'arraybuffer',
      });
      const text = decodeHtmlBuffer(resp.data as ArrayBuffer);
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return [];
      const json = JSON.parse(jsonMatch[0]);
      const data = json.LivesList || json.data || [];
      const items = (Array.isArray(data) ? data : []).map((item: any) => this.mapItem(item));
      console.log(`[eastmoney] Fallback: fetched ${items.length} items`);
      return items;
    } catch (err) {
      console.error('[eastmoney] Fallback also failed:', (err as Error).message);
      return [];
    }
  }

  private mapItem(item: any): RawItem {
    return {
      title: item.title || item.Title || '',
      content: item.digest || item.content || item.Content || item.title || item.Title || '',
      sourceName: '东方财富',
      author: item.source || item.mediaName || '东方财富',
      url: item.url || item.Url || item.url_unique || 'https://finance.eastmoney.com/',
      publishedAt: this.parseTime(item.showtime || item.display_time || item.ShowTime || ''),
      metrics: { comments: item.comment_count || 0 },
    };
  }
}

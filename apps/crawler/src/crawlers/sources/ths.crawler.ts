import * as cheerio from 'cheerio';
import type { AxiosInstance } from 'axios';
import { decodeHtmlBuffer, type CrawlerConfig } from '@fin/core';
import { BaseCrawler, type RawItem } from '../base.crawler';

/** 同花顺财经要闻爬虫（移植原实现：JSON 接口 + cheerio HTML 兜底，站点可能 GBK 编码） */
export class ThsCrawler extends BaseCrawler {
  constructor(http: AxiosInstance, overrides?: Partial<CrawlerConfig>) {
    super({
      name: 'ths',
      sourceName: '同花顺',
      sourceType: 'news',
      http,
      configOverrides: { intervalMinutes: 15, ...overrides },
    });
  }

  protected async doFetch(): Promise<RawItem[]> {
    const allItems: RawItem[] = [];

    try {
      const resp = await this.http.get('https://news.10jqka.com.cn/tapp/news/push/stock/', {
        params: { page: 1, tag: '', track: 'website', pagesize: this.config.pageSize },
        headers: { Referer: 'https://news.10jqka.com.cn/' },
      });

      let data: any[];
      if (resp.data?.data?.list) {
        data = resp.data.data.list;
      } else if (Array.isArray(resp.data?.data)) {
        data = resp.data.data;
      } else {
        data = await this.fallbackHtmlParse();
      }

      for (const item of data) {
        allItems.push({
          title: item.title || '',
          content: item.digest || item.content || item.title || '',
          sourceName: item.source || '同花顺',
          author: item.source || '同花顺',
          url: item.url || 'https://news.10jqka.com.cn/',
          publishedAt: this.parseTime(item.ctime || item.rtime || ''),
          metrics: { comments: item.comment_count || 0, views: item.click_count || 0 },
        });
      }
      console.log(`[ths] Fetched ${allItems.length} items`);
    } catch (err) {
      console.error('[ths] Fetch failed:', (err as Error).message);
      throw err;
    }
    return allItems;
  }

  private async fallbackHtmlParse(): Promise<any[]> {
    const resp = await this.http.get('https://news.10jqka.com.cn/', { responseType: 'arraybuffer' });
    const html = decodeHtmlBuffer(resp.data as ArrayBuffer);
    const $ = cheerio.load(html);
    const items: any[] = [];

    $('ul.list-con li, .news-list li').each((_i, el) => {
      const $el = $(el);
      const link = $el.find('a').first();
      const title = link.text().trim();
      const href = link.attr('href') || '';
      const time = $el.find('.arc-time, time, .time').text().trim();
      if (title && title.length > 4) {
        items.push({
          title,
          content: title,
          url: href.startsWith('http') ? href : `https://news.10jqka.com.cn${href}`,
          ctime: time,
          source: '同花顺',
        });
      }
    });
    return items;
  }
}

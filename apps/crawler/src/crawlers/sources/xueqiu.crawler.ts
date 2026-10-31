import type { AxiosInstance } from 'axios';
import { stripHtml, type CrawlerConfig } from '@fin/core';
import { BaseCrawler, type RawItem } from '../base.crawler';

/**
 * 雪球热帖爬虫（移植原实现）
 * 需要先访问主页获取 cookie 才能调用 listV2 热榜接口。
 */
export class XueqiuCrawler extends BaseCrawler {
  private cookie = '';

  constructor(http: AxiosInstance, overrides?: Partial<CrawlerConfig>) {
    super({
      name: 'xueqiu',
      sourceName: '雪球',
      sourceType: 'social',
      http,
      configOverrides: { intervalMinutes: 15, ...overrides },
    });
  }

  protected async doFetch(): Promise<RawItem[]> {
    await this.initCookie();

    const resp = await this.http.get('https://xueqiu.com/statuses/hot/listV2.json', {
      params: { since_id: -1, max_id: -1, size: this.config.pageSize },
      headers: {
        Cookie: this.cookie,
        Referer: 'https://xueqiu.com/',
        Origin: 'https://xueqiu.com',
      },
    });

    const items = resp.data?.items || resp.data?.list || [];
    const allItems: RawItem[] = [];

    for (const item of items) {
      const original = item.original_status || item;
      const text = original.text || original.description || '';
      const title = original.title || this.extractTitle(text);
      allItems.push({
        title,
        content: text,
        sourceName: '雪球',
        author: original.user?.screen_name || '雪球用户',
        url: `https://xueqiu.com${original.target || `/statuses/${original.id}`}`,
        publishedAt: this.parseTime(original.created_at),
        metrics: {
          likes: original.like_count || 0,
          comments: original.reply_count || 0,
          shares: original.retweet_count || 0,
        },
      });
    }
    console.log(`[xueqiu] Fetched ${allItems.length} hot items`);
    return allItems;
  }

  private async initCookie(): Promise<void> {
    if (this.cookie) return;
    try {
      const resp = await this.http.get('https://xueqiu.com/', { maxRedirects: 5 });
      const setCookies = resp.headers['set-cookie'];
      if (setCookies) {
        this.cookie = setCookies.map((c: string) => c.split(';')[0]).join('; ');
      }
    } catch {
      console.warn('[xueqiu] Failed to get initial cookie');
    }
  }

  private extractTitle(text: string): string {
    const clean = stripHtml(text);
    return clean.length > 60 ? clean.substring(0, 60) + '...' : clean;
  }
}

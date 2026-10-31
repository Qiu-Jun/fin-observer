/**
 * 市场工具：东财 secid 解析、交易时间窗口、日期格式化。
 * 时区统一按 Asia/Shanghai（A 股）。
 */

const MARKET_TZ = 'Asia/Shanghai';

/** 上证大盘基准（资金流数据中的特殊 code，与个股/ETF 区分） */
export const MARKET_INDEX_CODE = 'sh000001';
export const MARKET_INDEX_SECID = '1.000001';
export const MARKET_INDEX_NAME = '上证指数';

/** 根据 6 位代码推断东方财富 secid：沪 1.XXXXXX / 深 0.XXXXXX */
export function resolveSecid(code: string): string {
  const c = code.trim();
  // 沪市：股票 60/68 开头，ETF/LOF 5 开头，B股 9 开头
  if (/^(5|6|9)/.test(c)) return `1.${c}`;
  return `0.${c}`;
}

export function getMarketTime(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: MARKET_TZ }));
}

export function isWeekday(d: Date): boolean {
  const day = d.getDay();
  return day >= 1 && day <= 5;
}

/** 东财日K资金流的日期格式 yyyy-MM-dd */
export function formatTradeDate(d: Date = getMarketTime()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function formatLocalIso(d: Date = new Date()): string {
  return d.toISOString();
}

/** 内容采集窗口（工作日） */
export const CRAWL_WINDOWS_WEEKDAY = [
  { hour: 8, min: 15 },
  { hour: 8, min: 45 },
  { hour: 11, min: 55 },
  { hour: 12, min: 25 },
  { hour: 15, min: 10 },
];

/** 非交易日低峰窗口 */
export const CRAWL_WINDOWS_WEEKEND = [
  { hour: 2, min: 0 },
  { hour: 4, min: 0 },
];

/**
 * 内容列表去重：按 id 与非空 url 双重去重（模拟原 INSERT OR IGNORE 语义）
 */
export function dedupeByIdUrl<T extends { id: string; url?: string | null }>(items: T[]): T[] {
  const seenId = new Set<string>();
  const seenUrl = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    if (item.id && seenId.has(item.id)) continue;
    const url = item.url?.trim();
    if (url && seenUrl.has(url)) continue;
    if (item.id) seenId.add(item.id);
    if (url) seenUrl.add(url);
    out.push(item);
  }
  return out;
}

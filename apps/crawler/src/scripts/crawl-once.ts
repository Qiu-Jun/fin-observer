/**
 * 单次采集脚本（独立于 Nest 容器，供安装后快速验证数据链路）：
 *   pnpm crawl:once
 * 流程：建 DataSource → 跑全部内容爬虫 + 关键字搜索 → 匹配/事件/情绪 → 入库。
 */
import 'dotenv/config';
import 'reflect-metadata';
import * as path from 'node:path';
import axios from 'axios';
import { DataSource } from 'typeorm';
import { v4 as uuid } from 'uuid';
import {
  CORE_ENTITIES,
  analyzeSentimentBatch,
  buildSubscriptionTerms,
  isLlmEnabled,
  matchSubscriptions,
  recognizeEvents,
  toBaseSentimentLabel,
  type ContentItem,
  type SubscriptionEntity,
} from '@fin/core';
import { resolveDbPath } from '../config/paths';
import { EastMoneyCrawler } from '../crawlers/sources/eastmoney.crawler';
import { SinaCrawler } from '../crawlers/sources/sina.crawler';
import { YicaiCrawler } from '../crawlers/sources/yicai.crawler';
import { ThsCrawler } from '../crawlers/sources/ths.crawler';
import { XueqiuCrawler } from '../crawlers/sources/xueqiu.crawler';
import { KeywordSearchService } from '../crawlers/keyword-search.service';

async function main() {
  const dataSource = new DataSource({
    type: 'better-sqlite3',
    database: resolveDbPath(),
    entities: [...CORE_ENTITIES],
    synchronize: true,
    extra: { timeout: 5000 },
  });
  await dataSource.initialize();
  console.log(`[crawl-once] DB: ${path.basename(resolveDbPath())}`);

  const http = axios.create({
    timeout: 15000,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    },
  });

  const crawlers = [
    new EastMoneyCrawler(http),
    new SinaCrawler(http),
    new YicaiCrawler(http),
    new ThsCrawler(http),
    new XueqiuCrawler(http),
  ];

  const contentRepo = dataSource.getRepository('ContentEntity');
  const subRepo = dataSource.getRepository('SubscriptionEntity');

  const subs = (await subRepo.find({ where: { enabled: true } })) as SubscriptionEntity[];
  const lexicons = subs.map((sub) => {
    const lex = { id: sub.id, name: sub.name, code: sub.code, type: sub.type, aliases: sub.aliases ?? [] };
    return { sub: lex, terms: buildSubscriptionTerms(lex) };
  });
  const extraSubjects = [...new Set(lexicons.flatMap(({ sub }) => [sub.name, ...(sub.aliases ?? [])]))].filter(
    (n) => n && n.length >= 2,
  );

  const knownIds = new Set<string>(
    ((await contentRepo.find({ select: { id: true } })) as Array<{ id: string }>).map((r) => r.id),
  );

  let totalAdded = 0;

  const processItems = async (items: ContentItem[], source: string): Promise<number> => {
    const fresh = items.filter((it) => !knownIds.has(it.id));
    if (fresh.length === 0) {
      console.log(`[${source}] fetched ${items.length}, all known`);
      return 0;
    }
    for (const item of fresh) {
      item.matches = matchSubscriptions(
        { title: item.title, content: item.content, entityNames: (item.nlp.entities ?? []).map((e) => e.name) },
        lexicons,
      );
      const events = recognizeEvents(`${item.title} ${item.content}`, extraSubjects);
      if (events.length > 0) item.nlp.events = events;
    }
    const candidates = fresh.filter((it) => it.matches.length > 0);
    if (candidates.length > 0 && isLlmEnabled()) {
      console.log(`[${source}] ${candidates.length} matched → LLM batch`);
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

    let added = 0;
    for (const item of fresh) {
      try {
        await contentRepo.insert({
          ...item,
          publishedAt: new Date(item.publishedAt),
          fetchedAt: new Date(item.fetchedAt),
        });
        knownIds.add(item.id);
        added += 1;
      } catch {
        // 唯一冲突跳过
      }
    }
    console.log(`[${source}] fetched ${items.length}, added ${added}`);
    totalAdded += added;
    return added;
  };

  for (const crawler of crawlers) {
    try {
      const result = await crawler.crawl();
      if (result.success) await processItems(result.items, crawler.name);
      else console.warn(`[${crawler.name}] failed: ${result.error}`);
    } catch (err) {
      console.error(`[${crawler.name}] error:`, err instanceof Error ? err.message : err);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }

  // 关键字搜索（轮游 3 个订阅）
  if (subs.length > 0) {
    const search = new KeywordSearchService(http);
    const items = await search.searchRoundRobin(subs, 3);
    await processItems(items, 'keyword-search');
  }

  console.log(`\n[crawl-once] done, total added ${totalAdded}`);
  await dataSource.destroy();
}

main().catch((err) => {
  console.error('[crawl-once] fatal:', err);
  process.exit(1);
});

// 防止 uuid 未使用告警（脚本内直接展开对象插入，未单独调用 uuid）
void uuid;

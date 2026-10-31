/**
 * 订阅主体相关度评分（移植自原项目 relevanceService 的 4 维权重）
 *   标题命中 40 / 正文频次 30（每命中原词 +5，封顶）/ NLP 实体命中 20 / 首段(前200字)命中 10
 * 评分对象从原项目的"行业"扩展为"订阅主体"（个股/ETF）。
 * ≥60 核心主体；<30 顺带提及。
 */

import type { SubscriptionLexicon, SubscriptionMatch } from '../types';

export interface MatchInputText {
  title: string;
  content: string;
  /** sentiment.ts 抽取出的实体名列表（可选，用于实体维度加分） */
  entityNames?: string[];
}

/** 订阅的匹配词表：名称 + 6位代码 + 别名，去重去空 */
export function buildSubscriptionTerms(sub: SubscriptionLexicon): string[] {
  const terms = [sub.name, sub.code, ...(sub.aliases ?? [])]
    .map((t) => (t ?? '').trim())
    .filter((t) => t.length >= 2);
  return [...new Set(terms)];
}

function countOccurrences(text: string, term: string): number {
  if (!term) return 0;
  let count = 0;
  let idx = text.indexOf(term);
  while (idx !== -1) {
    count += 1;
    idx = text.indexOf(term, idx + term.length);
  }
  return count;
}

/**
 * 对一条内容与全部订阅词表做匹配评分，返回按相关度降序的命中列表。
 * 匹配词表可预先构建缓存（buildSubscriptionTerms），避免每次重算。
 */
export function matchSubscriptions(
  input: MatchInputText,
  lexicons: Array<{ sub: SubscriptionLexicon; terms: string[] }>,
): SubscriptionMatch[] {
  const title = input.title ?? '';
  const content = input.content ?? '';
  const firstPara = content.slice(0, 200);
  const entityNames = new Set(input.entityNames ?? []);
  const matches: SubscriptionMatch[] = [];

  for (const { sub, terms } of lexicons) {
    let score = 0;
    let matchedKeyword = '';

    // 维度1：标题命中（任一词命中一次性 +40）
    const titleHit = terms.find((t) => title.includes(t));
    if (titleHit) {
      score += 40;
      matchedKeyword = titleHit;
    }

    // 维度2：正文频次（总次数 ×5，封顶 30）
    let freq = 0;
    for (const t of terms) {
      freq += countOccurrences(content, t);
      if (!matchedKeyword && freq > 0) matchedKeyword = t;
    }
    if (freq > 0) score += Math.min(30, freq * 5);

    // 维度3：NLP 实体命中（+20）
    const entityHit = terms.find((t) => entityNames.has(t));
    if (entityHit) {
      score += 20;
      if (!matchedKeyword) matchedKeyword = entityHit;
    }

    // 维度4：首段命中（+10）
    if (!titleHit && terms.some((t) => firstPara.includes(t))) {
      score += 10;
    }

    if (score <= 0) continue;

    matches.push({
      subscriptionId: sub.id,
      keyword: matchedKeyword || sub.name,
      score,
      isCoreSubject: score >= 60,
      isMentionOnly: score < 30,
    });
  }

  return matches.sort((a, b) => b.score - a.score);
}

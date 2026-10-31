/**
 * LLM 增强情绪分析（移植自原项目 financialSentimentModel 的架构，简化为单阶段）
 * - 配置 PRIMARY_LLM_API_KEY/BASE_URL/MODEL（任何 OpenAI 兼容接口）即启用
 * - 批量合并 prompt：20 条/次，降低调用次数与 429 风险
 * - 全局限速：并发 3 + 最小间隔 300ms
 * - 未配置/失败自动降级词典模型，保证管线永不中断
 */

import axios from 'axios';
import type { FinancialSentimentLabel, SourceType } from '../types';
import { analyzeSentiment } from './sentiment';

const LLM_BASE_URL = process.env.PRIMARY_LLM_BASE_URL ?? 'https://api.deepseek.com/v1';
const LLM_MODEL = process.env.PRIMARY_LLM_MODEL ?? 'deepseek-chat';
const LLM_API_KEY = process.env.PRIMARY_LLM_API_KEY ?? '';

const LLM_CONCURRENCY = 3;
const LLM_MIN_INTERVAL_MS = 300;
let llmActiveCount = 0;
let llmLastRequestTime = 0;

const LLM_SYSTEM_PROMPT = `你是一位中国金融市场舆情分析师。快速判断给定文本的金融情绪，输出严格 JSON，不要包含额外文字：
{
  "label": "strong_positive|weak_positive|neutral|weak_negative|strong_negative|risk|rumor",
  "confidence": 0.0~1.0,
  "reasoning": "一句话判断理由（中文）",
  "positiveSignals": ["正面关键词"],
  "negativeSignals": ["负面关键词"],
  "riskSignals": ["风险关键词"],
  "rumorSignals": ["传闻关键词"]
}
标签：strong_positive=强利好, weak_positive=弱利好, neutral=中性, weak_negative=弱利空, strong_negative=强利空, risk=风险事件, rumor=未证实传闻`;

const BATCH_SIZE = 10;
const BATCH_TIMEOUT_MS = 120000; // 推理类模型（如 glm/deepseek-r1）单批较慢，放宽超时
const VALID_LABELS: FinancialSentimentLabel[] = [
  'strong_positive', 'weak_positive', 'neutral',
  'weak_negative', 'strong_negative', 'risk', 'rumor',
];

export interface LLMInput {
  text: string;
  sourceType?: SourceType;
}

export function isLlmEnabled(): boolean {
  return LLM_API_KEY.length > 0;
}

/** 词典兜底：由基础情绪分推导七级标签 */
function dictionaryResult(text: string): {
  label: FinancialSentimentLabel;
  confidence: number;
  reasoning: string;
  positiveSignals: string[];
  negativeSignals: string[];
  riskSignals: string[];
  rumorSignals: string[];
} {
  const base = analyzeSentiment(text);
  let label: FinancialSentimentLabel = 'neutral';
  if (base.riskLevel === 'critical' || base.riskLevel === 'high') {
    label = 'risk';
  } else if (base.score >= 0.5) label = 'strong_positive';
  else if (base.score > 0.15) label = 'weak_positive';
  else if (base.score <= -0.5) label = 'strong_negative';
  else if (base.score < -0.15) label = 'weak_negative';

  return {
    label,
    confidence: Math.min(0.9, 0.4 + Math.abs(base.score) * 0.5),
    reasoning: '词典模型判定',
    positiveSignals: base.positiveHits,
    negativeSignals: base.negativeHits,
    riskSignals: base.riskHits,
    rumorSignals: [],
  };
}

async function callLLM(systemPrompt: string, userContent: string, maxTokens: number): Promise<string> {
  while (llmActiveCount >= LLM_CONCURRENCY) {
    await new Promise((r) => setTimeout(r, 100));
  }
  const elapsed = Date.now() - llmLastRequestTime;
  if (elapsed < LLM_MIN_INTERVAL_MS) {
    await new Promise((r) => setTimeout(r, LLM_MIN_INTERVAL_MS - elapsed));
  }
  llmActiveCount += 1;
  llmLastRequestTime = Date.now();
  try {
    const resp = await axios.post<{ choices: { message: { content: string } }[] }>(
      `${LLM_BASE_URL}/chat/completions`,
      {
        model: LLM_MODEL,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        temperature: 0.1,
        max_tokens: maxTokens,
      },
      { headers: { Authorization: `Bearer ${LLM_API_KEY}` }, timeout: BATCH_TIMEOUT_MS },
    );
    return resp.data.choices[0]?.message?.content ?? '{}';
  } finally {
    llmActiveCount -= 1;
  }
}

function normalize(parsed: Record<string, any>): {
  label: FinancialSentimentLabel;
  confidence: number;
  reasoning: string;
  positiveSignals: string[];
  negativeSignals: string[];
  riskSignals: string[];
  rumorSignals: string[];
} {
  const label: FinancialSentimentLabel = VALID_LABELS.includes(parsed?.label) ? parsed.label : 'neutral';
  return {
    label,
    confidence: Math.min(1, Math.max(0, Number(parsed?.confidence) || 0.7)),
    reasoning: String(parsed?.reasoning ?? ''),
    positiveSignals: Array.isArray(parsed?.positiveSignals) ? parsed.positiveSignals : [],
    negativeSignals: Array.isArray(parsed?.negativeSignals) ? parsed.negativeSignals : [],
    riskSignals: Array.isArray(parsed?.riskSignals) ? parsed.riskSignals : [],
    rumorSignals: Array.isArray(parsed?.rumorSignals) ? parsed.rumorSignals : [],
  };
}

/**
 * 批量情绪分析：有 LLM key 走批量合并调用（失败降级词典），无 key 直接词典。
 * 返回顺序与输入一一对应。
 */
export async function analyzeSentimentBatch(
  items: LLMInput[],
): Promise<Array<{ label: FinancialSentimentLabel; confidence: number; reasoning: string; modelSource: 'dictionary' | 'llm'; positiveSignals: string[]; negativeSignals: string[]; riskSignals: string[]; rumorSignals: string[] }>> {
  const fallback = () => items.map((it) => ({ ...dictionaryResult(it.text), modelSource: 'dictionary' as const }));

  if (!isLlmEnabled() || items.length === 0) return fallback();

  const results: Array<Record<string, any> | null> = new Array(items.length).fill(null);

  for (let start = 0; start < items.length; start += BATCH_SIZE) {
    const batch = items.slice(start, start + BATCH_SIZE);
    const numbered = batch
      .map((it, idx) => `[${idx + 1}]${it.sourceType ? `(${it.sourceType})` : ''} ${it.text.slice(0, 300)}`)
      .join('\n');
    try {
      const raw = await callLLM(
        LLM_SYSTEM_PROMPT +
          '\n\n批量分析模式：返回 {"results": [...]} 数组，按输入顺序逐条输出，每个元素包含 label, confidence, reasoning, positiveSignals, negativeSignals, riskSignals, rumorSignals。',
        `请对以下 ${batch.length} 条金融文本逐条分析情绪，返回 JSON 数组：\n${numbered}`,
        6144,
      );
      const parsed = JSON.parse(raw);
      const list: any[] = Array.isArray(parsed?.results) ? parsed.results : Array.isArray(parsed) ? parsed : [];
      list.forEach((r, idx) => {
        if (start + idx < items.length) results[start + idx] = r ?? null;
      });
    } catch (err) {
      console.warn(
        `[llm] Batch analysis failed (${err instanceof Error ? err.message : err}), falling back to dictionary for this batch`,
      );
    }
  }

  return results.map((r, idx) => {
    if (r) return { ...normalize(r), modelSource: 'llm' as const };
    return { ...dictionaryResult(items[idx].text), modelSource: 'dictionary' as const };
  });
}

/** 单条增强分析（重分析接口用） */
export async function analyzeSentimentSingle(text: string, sourceType?: SourceType) {
  const [result] = await analyzeSentimentBatch([{ text, sourceType }]);
  return result;
}

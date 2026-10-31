import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThanOrEqual } from 'typeorm';
import {
  heatLevel,
  ContentEntity,
  SubscriptionEntity,
  TemperatureSnapshotEntity,
  type SubscriptionHeat,
} from '@fin/core';

/**
 * 订阅热度（移植原温度公式：情绪 35% + 声量 35% + 传播 30%），
 * 评分对象从行业改为订阅主体，按请求计算并写快照。
 */
@Injectable()
export class TemperatureService {
  constructor(
    @InjectRepository(SubscriptionEntity)
    private readonly subRepo: Repository<SubscriptionEntity>,
    @InjectRepository(ContentEntity)
    private readonly contentRepo: Repository<ContentEntity>,
    @InjectRepository(TemperatureSnapshotEntity)
    private readonly snapshotRepo: Repository<TemperatureSnapshotEntity>,
  ) {}

  /** 近 24h 各订阅热度（降序） */
  async computeAll(granularity: 'hour' | 'day' = 'hour'): Promise<SubscriptionHeat[]> {
    const since = new Date(Date.now() - 24 * 3600 * 1000);
    const subs = await this.subRepo.find({ where: { enabled: true } });
    const contents = await this.contentRepo.find({
      select: ['id', 'title', 'matches', 'nlp', 'metrics', 'publishedAt'],
      where: { publishedAt: MoreThanOrEqual(since) },
    });

    const perSub = new Map<string, typeof contents>();
    for (const c of contents) {
      const matches = c.matches ?? [];
      for (const m of matches) {
        const list = perSub.get(m.subscriptionId) ?? [];
        list.push(c);
        perSub.set(m.subscriptionId, list);
      }
    }

    const results: SubscriptionHeat[] = subs.map((sub) => {
      const items = perSub.get(sub.id) ?? [];
      const weightOf = (c: (typeof contents)[number]) =>
        Math.max(0.2, Math.min(1, (c.matches ?? []).find((m) => m.subscriptionId === sub.id)?.score ?? 0) / 100);

      // 1) 情绪分：相关度加权平均情绪 → [0,100]
      const emotionRaw =
        items.length > 0
          ? items.reduce((acc, c) => acc + (c.nlp?.sentiment ?? 0) * weightOf(c), 0) /
            Math.max(0.001, items.reduce((acc, c) => acc + weightOf(c), 0))
          : 0;
      const emotionScore = Math.round(((emotionRaw + 1) / 2) * 100);

      // 2) 声量：事件簇近似（去重 URL 后条数）对数归一化（上限 50 条封顶）
      const distinctUrls = new Set(items.map((i) => i.id)).size;
      const volumeScore = Math.round((Math.log(1 + distinctUrls) / Math.log(1 + 50)) * 100);

      // 3) 传播热度：互动量加权对数归一化
      const interaction = items.reduce(
        (acc, c) =>
          acc +
          ((c.metrics?.likes ?? 0) + (c.metrics?.comments ?? 0) + (c.metrics?.shares ?? 0) + (c.metrics?.views ?? 0) * 0.1) *
            weightOf(c),
        0,
      );
      const propagationScore = Math.round((Math.log(1 + interaction) / Math.log(1 + 5000)) * 100);

      const score = Math.round(emotionScore * 0.35 + volumeScore * 0.35 + propagationScore * 0.3);
      const negCount = items.filter((i) => i.nlp?.sentimentLabel === 'negative').length;

      return {
        subscriptionId: sub.id,
        name: sub.name,
        code: sub.code,
        type: sub.type,
        score,
        level: heatLevel(score),
        emotionScore,
        volumeScore,
        propagationScore,
        contentCount: items.length,
        negativeRatio: items.length > 0 ? negCount / items.length : 0,
      };
    });

    await this.persist(results, granularity);
    return results.sort((a, b) => b.score - a.score);
  }

  private async persist(heats: SubscriptionHeat[], granularity: 'hour' | 'day'): Promise<void> {
    const now = new Date();
    const bucketTs =
      granularity === 'hour'
        ? new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours()).toISOString()
        : new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    for (const h of heats) {
      try {
        await this.snapshotRepo.upsert(
          {
            id: `${h.subscriptionId}:${granularity}:${bucketTs}`,
            subscriptionId: h.subscriptionId,
            granularity,
            bucketTs,
            score: h.score,
            breakdown: {
              emotionScore: h.emotionScore,
              volumeScore: h.volumeScore,
              propagationScore: h.propagationScore,
              contentCount: h.contentCount,
              negativeRatio: Number(h.negativeRatio.toFixed(2)),
            },
            computedAt: now,
          },
          ['id'],
        );
      } catch {
        // 快照写入失败不影响查询
      }
    }
  }
}

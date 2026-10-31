import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuid } from 'uuid';
import { resolveSecid, SubscriptionEntity } from '@fin/core';
import { CrawlerControlClientService } from '../grpc/crawler-control.client';

export interface CreateSubscriptionDto {
  type: 'stock' | 'etf';
  code: string;
  name: string;
  aliases?: string[] | string;
  notes?: string;
  enabled?: boolean;
}

/** 订阅管理：CRUD + 生命周期事件经 gRPC 通知 crawler 服务 */
@Injectable()
export class SubscriptionsService implements OnModuleInit {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    @InjectRepository(SubscriptionEntity)
    private readonly repo: Repository<SubscriptionEntity>,
    private readonly crawlerClient: CrawlerControlClientService,
  ) {}

  /** 首次启动种入示例订阅，便于开箱验证 */
  async onModuleInit(): Promise<void> {
    if (process.env.SEED_DEMO === 'false') return;
    const count = await this.repo.count();
    if (count > 0) return;
    this.logger.log('Seeding demo subscriptions...');
    for (const demo of [
      { type: 'stock' as const, code: '600519', name: '贵州茅台', aliases: ['茅台', 'Moutai'] },
      { type: 'etf' as const, code: '510300', name: '沪深300ETF', aliases: ['沪深300'] },
    ]) {
      await this.create({ ...demo, notes: '示例订阅（SEED_DEMO=true 自动创建）' });
    }
  }

  async list(): Promise<SubscriptionEntity[]> {
    return this.repo.find({ order: { createdAt: 'DESC' } });
  }

  async get(id: string): Promise<SubscriptionEntity> {
    const sub = await this.repo.findOne({ where: { id } });
    if (!sub) throw new NotFoundException(`Subscription not found: ${id}`);
    return sub;
  }

  async create(dto: CreateSubscriptionDto): Promise<SubscriptionEntity> {
    const code = dto.code.trim();
    if (!/^\d{6}$/.test(code)) throw new Error('股票/ETF 代码必须为 6 位数字');
    const exists = await this.repo.findOne({ where: { code } });
    if (exists) throw new Error(`订阅已存在: ${code} ${exists.name}`);

    const now = new Date();
    const entity = this.repo.create({
      id: uuid(),
      type: dto.type === 'etf' ? 'etf' : 'stock',
      code,
      name: dto.name.trim(),
      secid: resolveSecid(code),
      aliases: this.normalizeAliases(dto.aliases),
      enabled: dto.enabled ?? true,
      notes: dto.notes ?? null,
      createdAt: now,
      updatedAt: now,
    });
    const saved = await this.repo.save(entity);
    await this.notify({ action: 'created', sub: saved });
    return saved;
  }

  async update(id: string, dto: Partial<CreateSubscriptionDto>): Promise<SubscriptionEntity> {
    const sub = await this.get(id);
    if (dto.type) sub.type = dto.type;
    if (dto.name) sub.name = dto.name.trim();
    if (dto.aliases !== undefined) sub.aliases = this.normalizeAliases(dto.aliases);
    if (dto.notes !== undefined) sub.notes = dto.notes;
    if (dto.enabled !== undefined) sub.enabled = dto.enabled;
    sub.updatedAt = new Date();
    const saved = await this.repo.save(sub);
    await this.notify({ action: 'updated', sub: saved });
    return saved;
  }

  async remove(id: string): Promise<void> {
    const sub = await this.get(id);
    await this.repo.remove(sub);
    await this.notify({ action: 'deleted', sub });
  }

  private normalizeAliases(aliases?: string[] | string): string[] | null {
    if (!aliases) return null;
    const list = Array.isArray(aliases)
      ? aliases
      : aliases.split(/[,，;；\s]+/);
    const clean = [...new Set(list.map((a) => a?.trim()).filter((a) => a && a.length >= 2))];
    return clean.length > 0 ? clean : null;
  }

  private async notify({ action, sub }: { action: 'created' | 'updated' | 'deleted'; sub: SubscriptionEntity }): Promise<void> {
    await this.crawlerClient.tryCall(
      (client) =>
        client.OnSubscriptionChanged({
          action,
          subscriptionId: sub.id,
          type: sub.type,
          code: sub.code,
          name: sub.name,
          secid: sub.secid,
          aliasesJson: JSON.stringify(sub.aliases ?? []),
        }),
      { ok: false, message: 'crawler service unavailable' },
    );
  }
}

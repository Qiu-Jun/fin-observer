import { Body, Controller, Delete, Get, NotFoundException, Param, Post, Put, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuid } from 'uuid';
import { AlertEntity, AlertRuleEntity, type AlertRuleConditions, type AlertStatus } from '@fin/core';
import { AlertEngineService } from './alert-engine.service';

@Controller()
export class AlertsController {
  constructor(
    @InjectRepository(AlertEntity) private readonly alertRepo: Repository<AlertEntity>,
    @InjectRepository(AlertRuleEntity) private readonly ruleRepo: Repository<AlertRuleEntity>,
    private readonly engine: AlertEngineService,
  ) {}

  // ── 预警 ───────────────────────────────────────────────────────────────────

  @Get('alerts')
  async list(
    @Query('status') status?: string,
    @Query('riskLevel') riskLevel?: string,
    @Query('limit') limit?: string,
  ) {
    const qb = this.alertRepo.createQueryBuilder('a');
    if (status) qb.andWhere('a.status = :status', { status });
    if (riskLevel) qb.andWhere('a.riskLevel = :riskLevel', { riskLevel });
    qb.orderBy('a.triggeredAt', 'DESC').take(limit ? parseInt(limit, 10) : 100);
    return qb.getMany();
  }

  @Get('alerts/:id')
  async get(@Param('id') id: string) {
    const alert = await this.alertRepo.findOne({ where: { id } });
    if (!alert) throw new NotFoundException(`Alert not found: ${id}`);
    return alert;
  }

  @Delete('alerts/:id')
  async deleteAlert(@Param('id') id: string) {
    await this.alertRepo.delete(id);
    return { ok: true };
  }

  @Post('alerts/:id/handle')
  async handle(@Param('id') id: string, @Body() body: { action: 'start_processing' | 'resolve' | 'ignore' | 'reopen'; note?: string }) {
    const alert = await this.get(id);
    const statusMap: Record<string, AlertStatus> = {
      start_processing: 'processing',
      resolve: 'resolved',
      ignore: 'ignored',
      reopen: 'pending',
    };
    alert.status = statusMap[body.action] ?? alert.status;
    alert.handledAt = body.action === 'reopen' ? null : new Date();
    alert.handleNote = body.note ?? alert.handleNote;
    return this.alertRepo.save(alert);
  }

  // ── 规则 ───────────────────────────────────────────────────────────────────

  @Get('alert-rules')
  listRules() {
    return this.ruleRepo.find({ order: { createdAt: 'DESC' } });
  }

  @Post('alert-rules')
  createRule(@Body() dto: { name: string; conditions: AlertRuleConditions; riskLevel?: string; enabled?: boolean }) {
    const now = new Date();
    return this.ruleRepo.save({
      id: uuid(),
      name: dto.name,
      conditions: dto.conditions ?? {},
      riskLevel: (dto.riskLevel as AlertRuleEntity['riskLevel']) ?? null,
      enabled: dto.enabled ?? true,
      createdAt: now,
      updatedAt: now,
    });
  }

  @Put('alert-rules/:id')
  async updateRule(@Param('id') id: string, @Body() dto: Partial<{ name: string; conditions: AlertRuleConditions; riskLevel?: string; enabled: boolean }>) {
    const rule = await this.ruleRepo.findOne({ where: { id } });
    if (!rule) throw new NotFoundException(`Alert rule not found: ${id}`);
    if (dto.name !== undefined) rule.name = dto.name;
    if (dto.conditions !== undefined) rule.conditions = dto.conditions;
    if (dto.riskLevel !== undefined) rule.riskLevel = dto.riskLevel as AlertRuleEntity['riskLevel'];
    if (dto.enabled !== undefined) rule.enabled = dto.enabled;
    rule.updatedAt = new Date();
    return this.ruleRepo.save(rule);
  }

  @Delete('alert-rules/:id')
  async deleteRule(@Param('id') id: string) {
    await this.ruleRepo.delete(id);
    return { ok: true };
  }

  /** 手动触发一次评估 */
  @Post('alerts/evaluate')
  async evaluate() {
    const created = await this.engine.evaluateOnce();
    return { created };
  }
}

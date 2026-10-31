import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  AlertEntity,
  AlertRuleEntity,
  ContentEntity,
  FundFlowSignalEntity,
  SubscriptionEntity,
} from '@fin/core';
import { TemperatureModule } from '../temperature/temperature.module';
import { AlertEngineService } from './alert-engine.service';
import { AlertsController } from './alerts.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([AlertEntity, AlertRuleEntity, ContentEntity, FundFlowSignalEntity, SubscriptionEntity]),
    TemperatureModule,
  ],
  controllers: [AlertsController],
  providers: [AlertEngineService],
  exports: [AlertEngineService],
})
export class AlertsModule {}

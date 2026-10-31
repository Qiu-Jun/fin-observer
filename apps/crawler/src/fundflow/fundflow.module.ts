import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  ContentEntity,
  FundFlowDailyEntity,
  FundFlowSignalEntity,
  SubscriptionEntity,
} from '@fin/core';
import { FundFlowService } from './fundflow.service';
import { PredictionService } from './prediction.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([FundFlowDailyEntity, FundFlowSignalEntity, ContentEntity, SubscriptionEntity]),
  ],
  providers: [FundFlowService, PredictionService],
  exports: [FundFlowService, PredictionService, TypeOrmModule],
})
export class FundflowModule {}

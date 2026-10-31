import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FundFlowDailyEntity, FundFlowSignalEntity } from '@fin/core';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { FundflowController } from './fundflow.controller';
import { FundflowQueryService } from './fundflow.service';

@Module({
  imports: [TypeOrmModule.forFeature([FundFlowDailyEntity, FundFlowSignalEntity]), SubscriptionsModule],
  controllers: [FundflowController],
  providers: [FundflowQueryService],
  exports: [FundflowQueryService],
})
export class FundflowApiModule {}

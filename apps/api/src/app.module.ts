import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { CORE_ENTITIES } from '@fin/core';
import { resolveDbPath } from './config/paths';
import { GrpcClientModule } from './grpc/grpc-client.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { ContentsModule } from './contents/contents.module';
import { FundflowApiModule } from './fundflow/fundflow.module';
import { AlertsModule } from './alerts/alerts.module';
import { TemperatureModule } from './temperature/temperature.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { CrawlersProxyModule } from './crawlers/crawlers.module';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'better-sqlite3',
      database: resolveDbPath(),
      entities: [...CORE_ENTITIES],
      synchronize: true,
      extra: { timeout: 5000 },
    }),
    ScheduleModule.forRoot(),
    GrpcClientModule,
    SubscriptionsModule,
    ContentsModule,
    FundflowApiModule,
    AlertsModule,
    TemperatureModule,
    DashboardModule,
    CrawlersProxyModule,
  ],
})
export class AppModule {}

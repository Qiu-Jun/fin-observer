import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AlertEntity, ContentEntity, FundFlowSignalEntity } from '@fin/core';
import { GrpcClientModule } from '../grpc/grpc-client.module';
import { TemperatureModule } from '../temperature/temperature.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([AlertEntity, ContentEntity, FundFlowSignalEntity]),
    GrpcClientModule,
    TemperatureModule,
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}

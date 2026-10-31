import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContentEntity, SubscriptionEntity, TemperatureSnapshotEntity } from '@fin/core';
import { TemperatureController } from './temperature.controller';
import { TemperatureService } from './temperature.service';

@Module({
  imports: [TypeOrmModule.forFeature([SubscriptionEntity, ContentEntity, TemperatureSnapshotEntity])],
  controllers: [TemperatureController],
  providers: [TemperatureService],
  exports: [TemperatureService],
})
export class TemperatureModule {}

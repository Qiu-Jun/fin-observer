import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContentEntity, CrawlLogEntity } from '@fin/core';
import { StorageService } from './storage.service';

@Module({
  imports: [TypeOrmModule.forFeature([ContentEntity, CrawlLogEntity])],
  providers: [StorageService],
  exports: [StorageService, TypeOrmModule],
})
export class StorageModule {}

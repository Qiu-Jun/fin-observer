import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { CORE_ENTITIES } from '@fin/core';
import { resolveDbPath } from './config/paths';
import { CrawlerModule } from './crawlers/crawlers.module';
import { GrpcModule } from './grpc/grpc.module';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'better-sqlite3',
      database: resolveDbPath(),
      entities: [...CORE_ENTITIES],
      synchronize: true, // 单机工具：自动同步 schema
      extra: { timeout: 5000 }, // SQLite busy_timeout，多进程共享文件时的等待上限
    }),
    ScheduleModule.forRoot(),
    CrawlerModule,
    GrpcModule,
  ],
})
export class AppModule {}

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CrawlLogEntity } from '@fin/core';
import { GrpcClientModule } from '../grpc/grpc-client.module';
import { CrawlersController } from './crawlers.controller';

@Module({
  imports: [TypeOrmModule.forFeature([CrawlLogEntity]), GrpcClientModule],
  controllers: [CrawlersController],
})
export class CrawlersProxyModule {}

import { Module } from '@nestjs/common';
import { CrawlerModule } from '../crawlers/crawlers.module';
import { CrawlerControlController } from './crawler-control.controller';

@Module({
  imports: [CrawlerModule],
  controllers: [CrawlerControlController],
})
export class GrpcModule {}

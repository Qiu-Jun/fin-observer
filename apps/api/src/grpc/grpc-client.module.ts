import { Module } from '@nestjs/common';
import { CrawlerControlClientService } from './crawler-control.client';

/**
 * gRPC 客户端模块：crawler-control.client 直接构建 proto-loader 通道，
 * 不再经过 NestJS ClientsModule（其懒连接在服务重启场景下行为不稳定）。
 */
@Module({
  providers: [CrawlerControlClientService],
  exports: [CrawlerControlClientService],
})
export class GrpcClientModule {}

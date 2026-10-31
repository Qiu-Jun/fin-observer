import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import type { MicroserviceOptions } from '@nestjs/microservices';
import { Transport } from '@nestjs/microservices';
import { GRPC_PACKAGE_NAME, resolveProtoPath } from '@fin/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('CrawlerApp');
  const app = await NestFactory.create(AppModule, { logger: ['log', 'warn', 'error'] });

  const grpcPort = process.env.CRAWLER_GRPC_PORT ?? '3002';
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.GRPC,
    options: {
      package: GRPC_PACKAGE_NAME,
      protoPath: resolveProtoPath(),
      url: `0.0.0.0:${grpcPort}`,
    },
  });
  await app.startAllMicroservices();

  // 保留一个轻量 HTTP 端口用于健康检查
  const httpPort = process.env.CRAWLER_HTTP_PORT ?? '3003';
  await app.listen(httpPort);

  logger.log(`gRPC control-plane listening on :${grpcPort}`);
  logger.log(`health-check HTTP listening on :${httpPort}`);
}

void bootstrap();

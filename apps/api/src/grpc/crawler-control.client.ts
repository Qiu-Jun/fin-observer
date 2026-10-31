import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import {
  GRPC_PACKAGE_NAME,
  GRPC_SERVICE_NAME,
  resolveProtoPath,
  type CrawlerControlClient,
} from '@fin/core';

export const CRAWLER_GRPC_CLIENT = 'CRAWLER_GRPC_CLIENT';

/**
 * gRPC 控制面客户端封装：所有对 crawler 服务的调用都经过这里。
 * 直接用 @grpc/proto-loader 构建通道（与 crawler 服务端同构、行为可预期），
 * 每次调用带 deadline 防挂死，crawler 服务未启动时优雅降级。
 */
@Injectable()
export class CrawlerControlClientService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CrawlerControlClientService.name);
  private client: CrawlerControlClient | undefined;
  private rawChannel: { close: () => void } | undefined;

  onModuleInit(): void {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const grpc = require('@grpc/grpc-js');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const protoLoader = require('@grpc/proto-loader');

    const packageDefinition = protoLoader.loadSync(resolveProtoPath(), { keepCase: false });
    const pkg = grpc.loadPackageDefinition(packageDefinition);
    const ServiceCtor = pkg[GRPC_PACKAGE_NAME]?.[GRPC_SERVICE_NAME];
    if (!ServiceCtor) {
      this.logger.error(`gRPC service ${GRPC_PACKAGE_NAME}.${GRPC_SERVICE_NAME} not found in proto`);
      return;
    }

    const url = process.env.CRAWLER_GRPC_URL ?? '127.0.0.1:3002';
    const raw = new ServiceCtor(url, grpc.credentials.createInsecure());
    this.rawChannel = raw;

    const wrap =
      (method: string, timeoutMs: number) =>
      (request: unknown): Promise<any> =>
        new Promise((resolve, reject) => {
          raw[method](request, { deadline: Date.now() + timeoutMs }, (err: unknown, response: any) =>
            err ? reject(err instanceof Error ? err : new Error(String(err))) : resolve(response),
          );
        });

    this.client = {
      RunCrawler: wrap('RunCrawler', 120_000),
      RunAllCrawlers: wrap('RunAllCrawlers', 300_000),
      GetCrawlerStatuses: wrap('GetCrawlerStatuses', 10_000),
      OnSubscriptionChanged: wrap('OnSubscriptionChanged', 120_000),
      ComputeSignals: wrap('ComputeSignals', 300_000),
    };
    this.logger.log(`gRPC control-plane client ready → ${url}`);
  }

  onModuleDestroy(): void {
    try {
      this.rawChannel?.close();
    } catch {
      // ignore
    }
  }

  /** crawler 服务未启动时优雅降级（返回 fallback，不抛出） */
  tryCall<T>(fn: (client: CrawlerControlClient) => Promise<T>, fallback: T): Promise<T> {
    if (!this.client) return Promise.resolve(fallback);
    return fn(this.client).catch((err) => {
      this.logger.warn(`gRPC call failed: ${err instanceof Error ? err.message : err}`);
      return fallback;
    });
  }
}

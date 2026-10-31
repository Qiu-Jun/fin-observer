/**
 * gRPC 消息 TS 类型（与 packages/proto/finobserver.proto 一一对应）。
 * 使用 @grpc/proto-loader 运行时加载 proto，此处仅提供客户端/服务端的强类型。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export interface GrpcAck {
  ok: boolean;
  message: string;
}

export interface RunCrawlerRequest {
  name: string;
}

export interface CrawlResultSummary {
  source: string;
  fetched: number;
  added: number;
  success: boolean;
  error: string;
  durationMs: number;
}

export interface RunAllSummary {
  results: CrawlResultSummary[];
}

export interface GrpcCrawlerStatus {
  name: string;
  sourceName: string;
  sourceType: string;
  enabled: boolean;
  isRunning: boolean;
  lastSuccess: boolean;
  lastError: string;
  lastCrawlAt: string;
  lastItemAt: string;
  totalFetched: number;
  consecutiveFailures: number;
  circuitOpen: boolean;
  healthScore: number;
}

export interface CrawlerStatusList {
  statuses: GrpcCrawlerStatus[];
}

export interface SubscriptionEvent {
  action: 'created' | 'updated' | 'deleted';
  subscriptionId: string;
  type: string;
  code: string;
  name: string;
  secid: string;
  aliasesJson: string;
}

/** gRPC 客户端接口（api 应用使用） */
export interface CrawlerControlClient {
  RunCrawler(request: RunCrawlerRequest): Promise<CrawlResultSummary>;
  RunAllCrawlers(request: Record<string, never>): Promise<RunAllSummary>;
  GetCrawlerStatuses(request: Record<string, never>): Promise<CrawlerStatusList>;
  OnSubscriptionChanged(request: SubscriptionEvent): Promise<GrpcAck>;
  ComputeSignals(request: Record<string, never>): Promise<GrpcAck>;
}

/**
 * proto 文件路径解析：
 * 1) PROTO_PATH 环境变量；2) 从 cwd 向上找 packages/proto/finobserver.proto（monorepo 布局）。
 */
export function resolveProtoPath(): string {
  if (process.env.PROTO_PATH) return process.env.PROTO_PATH;

  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, 'packages', 'proto', 'finobserver.proto');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    'finobserver.proto not found (searched packages/proto upward from cwd). Set PROTO_PATH env to the proto file path.',
  );
}

export const GRPC_PACKAGE_NAME = 'finobserver';
export const GRPC_SERVICE_NAME = 'CrawlerControl';

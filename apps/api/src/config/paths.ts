import * as fs from 'node:fs';
import * as path from 'node:path';

/** 共享数据目录解析（与 crawler 应用一致：默认 <项目根>/data） */
export function resolveDbPath(): string {
  if (process.env.DB_PATH) return process.env.DB_PATH;
  const dataDir = path.resolve(process.cwd(), '..', '..', 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  return path.join(dataDir, 'fin-observer.db');
}

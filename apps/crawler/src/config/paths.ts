import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * 共享数据目录解析：默认 <项目根>/data（apps/<x> 的上两级），
 * 可用 DB_PATH 覆盖为绝对路径。
 */
export function resolveDbPath(): string {
  if (process.env.DB_PATH) return process.env.DB_PATH;
  const dataDir = path.resolve(process.cwd(), '..', '..', 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  return path.join(dataDir, 'fin-observer.db');
}

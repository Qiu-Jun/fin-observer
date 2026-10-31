/**
 * 手动触发一次资金预测信号计算（独立脚本）：
 *   pnpm signals:once
 */
import 'dotenv/config';
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { CORE_ENTITIES } from '@fin/core';
import { resolveDbPath } from '../config/paths';
import { PredictionService } from '../fundflow/prediction.service';

async function main() {
  const dataSource = new DataSource({
    type: 'better-sqlite3',
    database: resolveDbPath(),
    entities: [...CORE_ENTITIES],
    synchronize: true,
    extra: { timeout: 5000 },
  });
  await dataSource.initialize();

  const prediction = new PredictionService(
    dataSource.getRepository('FundFlowDailyEntity'),
    dataSource.getRepository('FundFlowSignalEntity'),
    dataSource.getRepository('ContentEntity'),
    dataSource.getRepository('SubscriptionEntity'),
  );

  const count = await prediction.computeAllSignals();
  console.log(`[signals-once] ${count} signals computed`);

  await dataSource.destroy();
}

main().catch((err) => {
  console.error('[signals-once] fatal:', err);
  process.exit(1);
});

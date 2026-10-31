# fin-observer · 经济舆情监控平台

订阅 A 股股票/ETF → 关键字爬虫定向采集 → 结构化事件识别 → 主体相关度评分 → 资金走向分析 + 统计预测信号。

> ⚠️ 全平台的资金信号与预测均为**统计模型辅助信号，不构成投资建议**。

## 架构

```
fin-observer/
├── apps/
│   ├── api/        主服务 NestJS :3001（REST /api/v1 + 订阅/预警/热度/看板 + gRPC 客户端）
│   ├── crawler/    爬虫服务 NestJS :3002（gRPC 服务端 + 调度 cron + 资金流 + 预测信号）
│   └── web/        前端 Vue3 + Element Plus + ECharts :5173
├── packages/
│   ├── core/       共享领域层：类型 / TypeORM 实体 / NLP 词典 / LLM 适配器 / 工具
│   └── proto/      finobserver.proto（gRPC 契约，运行时加载，无需 protoc）
└── data/           SQLite 单文件（两个服务共享，WAL 模式）
```

**控制面**：api → gRPC（RunCrawler / RunAllCrawlers / GetCrawlerStatuses / OnSubscriptionChanged / ComputeSignals）。
**数据面**：两个服务共享同一 SQLite 文件；crawler 写 contents / fund_flow_daily / fund_flow_signals / crawl_logs，api 写 subscriptions / alerts / alert_rules。

## 快速开始

```bash
pnpm install
pnpm dev          # 同时起 api(3001) + crawler(3002) + web(5173)
```

首次启动（`SEED_DEMO=true`）自动创建示例订阅「贵州茅台 / 沪深300ETF」和 3 条默认预警规则；
创建订阅会经 gRPC 触发 **120 日资金流回填 + 按关键词的定向采集**。

打开 http://localhost:5173 即可使用。

### 启用 LLM 增强（可选）

编辑 `apps/crawler/.env`（任何 OpenAI 兼容接口均可）：

```ini
PRIMARY_LLM_API_KEY=sk-xxxx
PRIMARY_LLM_BASE_URL=https://api.deepseek.com/v1
PRIMARY_LLM_MODEL=deepseek-chat
```

留空 key 时自动降级为纯词典模型；LLM 只对「命中订阅」的内容调用（成本漏斗，20 条/批合并请求）。

## 采集调度（A 股节奏）

| 时间 | 动作 |
|---|---|
| 工作日 08:15 / 08:45 / 11:55 / 12:25 | 内容采集（东财快讯 / 新浪滚动 / 一财 / 同花顺 / 雪球热帖 + 订阅关键词搜索轮游） |
| 工作日 15:10 | 内容采集 + 全部订阅资金流日度更新（东财 push2his 日K资金流） |
| 工作日 15:20 | 预测信号计算 |
| 周末 02:00 / 04:00 | 低峰采集 |

手动触发：前端「系统设置」页，或 `POST /api/v1/crawlers/:name/run`（`fund-flow` 特指资金流更新）、`POST /api/v1/crawlers/compute-signals`。

## 核心 NLP 能力

- **结构化事件识别**（8 类）：政策变化 / 业绩预告 / 增减持 / 并购重组 / 监管处罚 / 债务违约 / 产业景气 / 评级变化 —— 关键词词典 + 方向/置信度
- **主体相关度评分**（4 维）：标题命中 40 / 正文频次 30 / 实体命中 20 / 首段命中 10；≥60 核心主体，<30 顺带提及；结果写入 `contents.matches`
- **情绪模型**：词典兜底（正/负/风险词表 + 三级风险）→ LLM 七级增强（strong_positive … risk / rumor）
- **订阅热度**：情绪 35% + 声量 35% + 传播 30%（近 24h）

## 资金走向与预测（辅助信号）

数据源：东方财富 `push2his` 日K资金流（主力/超大/大/中/小单净流入与占比、收盘价、涨跌幅）。

- **趋势研判 `trend_forecast`**：近 10 日主力净占比加权移动平均 + 线性回归斜率 → 流入加速 / 流入衰减 / 流出加速 / 流出企稳 / 横盘震荡，R² 作置信度
- **规则信号**：资金持续流入（5 日连入+占比抬升）/ 加速流出（3 日连出放大）/ 顶背离（价格新高+资金流出）/ 底背离（价格新低+资金流入）/ **舆情资金双杀**（负面舆情≥50% 且主力流出）/ 共振向好
- 预警引擎已接入资金信号条件（默认规则「资金利空信号预警」）

## 常用脚本

```bash
pnpm build          # 构建全部包
pnpm crawl:once     # 单次采集（独立脚本，不依赖服务）
pnpm signals:once   # 手动重算预测信号
```

## 已知边界

- 东财资金流/搜索接口为**非官方公开接口**，字段或可用性可能变动；已做字段映射层 + 重试 + 熔断，失败不影响其他模块
- 雪球热帖偶发需要 cookie 失效重取；抖音/小红书等强反爬平台未接入（架构留位）
- SQLite 为单机方案；未来多实例部署时 gRPC 控制面不变，数据面平迁 PostgreSQL
- 预测为统计外推，历史规律不保证未来重现

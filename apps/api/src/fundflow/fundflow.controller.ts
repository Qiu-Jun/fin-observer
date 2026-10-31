import { Controller, Get, Param, Query } from '@nestjs/common';
import { FundflowQueryService } from './fundflow.service';

@Controller()
export class FundflowController {
  constructor(private readonly service: FundflowQueryService) {}

  /** 订阅资金流摘要（最新一日 + 5 日主力累计） */
  @Get('fundflow/summary')
  summaries() {
    return this.service.summaries();
  }

  /** 大盘基准（上证指数） */
  @Get('fundflow/market')
  market(@Query('days') days?: string) {
    return this.service.marketFlow(days ? parseInt(days, 10) : 30);
  }

  /** 预测信号列表 */
  @Get('signals')
  signals(
    @Query('subscriptionId') subscriptionId?: string,
    @Query('direction') direction?: string,
    @Query('days') days?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.signals({
      subscriptionId,
      direction,
      days: days ? parseInt(days, 10) : 14,
      limit: limit ? parseInt(limit, 10) : 100,
    });
  }

  /** 某代码的日K资金流（个股/ETF 6位代码，或 sh000001 大盘） */
  @Get('fundflow/:code')
  flow(@Param('code') code: string, @Query('days') days?: string) {
    return this.service.getFlow(code, days ? parseInt(days, 10) : 60);
  }
}

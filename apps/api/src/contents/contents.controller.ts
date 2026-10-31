import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ContentsService, type ContentsQuery } from './contents.service';

@Controller()
export class ContentsController {
  constructor(private readonly service: ContentsService) {}

  @Get('contents')
  search(@Query() query: ContentsQuery) {
    return this.service.search(query);
  }

  @Get('contents/stats')
  stats(@Query('days') days?: string) {
    return this.service.stats(days ? parseInt(days, 10) : 7);
  }

  @Get('contents/events/distribution')
  eventDistribution(@Query('days') days?: string) {
    return this.service.eventDistribution(days ? parseInt(days, 10) : 7);
  }

  @Get('contents/events/timeline')
  eventTimeline(
    @Query('days') days?: string,
    @Query('limit') limit?: string,
    @Query('type') type?: string,
  ) {
    return this.service.eventTimeline(
      days ? parseInt(days, 10) : 7,
      limit ? parseInt(limit, 10) : 50,
      type,
    );
  }

  @Get('contents/:id')
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Post('contents/:id/reanalyze')
  reanalyze(@Param('id') id: string) {
    return this.service.reanalyze(id);
  }
}

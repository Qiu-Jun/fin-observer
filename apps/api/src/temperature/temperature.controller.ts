import { Controller, Get } from '@nestjs/common';
import { TemperatureService } from './temperature.service';

@Controller('temperatures')
export class TemperatureController {
  constructor(private readonly service: TemperatureService) {}

  /** 订阅热度榜（近24h） */
  @Get()
  list() {
    return this.service.computeAll();
  }
}

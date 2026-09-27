import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';

@ApiTags('Monitor')
@Controller('/monitor')
export class MonitorController {
  @Get('/health')
  @SkipThrottle()
  health() {
    return { status: 'ok' };
  }

  @Get('/queue/:name')
  async getMessagesGroup(@Param('name') name: string) {
    return {
      status: 'success',
      message: `Queue ${name} is healthy.`,
    };
  }
}

import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

@ApiTags('Sistema')
@Controller()
export class HealthController {
  @ApiOperation({ summary: 'Verificar estado del servidor' })
  @Get('health')
  health() {
    return { status: 'ok', ts: Date.now() };
  }
}

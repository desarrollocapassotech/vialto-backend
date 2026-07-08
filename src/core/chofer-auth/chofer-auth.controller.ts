import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ChoferAuthService } from './chofer-auth.service';
import { ChoferLoginDto } from './dto/chofer-login.dto';

/** Endpoints públicos (sin ClerkAuthGuard) consumidos por la app vialto-combustible. */
@ApiTags('Auth — App Combustible (chofer)')
@Controller('auth')
export class ChoferAuthController {
  constructor(private readonly service: ChoferAuthService) {}

  @ApiOperation({ summary: 'Login de chofer (DNI + PIN) — emite token propio para la app de combustible' })
  @Post('chofer-login')
  login(@Body() dto: ChoferLoginDto) {
    return this.service.login(dto);
  }
}

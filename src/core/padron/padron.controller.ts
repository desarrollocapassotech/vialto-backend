import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClerkAuthGuard, AuthPayload } from '../auth/clerk-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentAuth } from '../auth/current-auth.decorator';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { PadronService } from './padron.service';

/**
 * Sin ModuleGuard a propósito: la validación de CUIT está disponible para todo
 * tenant (usa el certificado de plataforma, no el ARCA del tenant). Los datos del
 * padrón son públicos y no pertenecen a ningún tenant — el tenantId solo se usa
 * para el tope diario de consultas.
 */
@ApiTags('Core — Padrón ARCA')
@ApiBearerAuth('clerk-jwt')
@Controller('padron')
@UseGuards(ClerkAuthGuard, TenantGuard, RolesGuard)
export class PadronController {
  constructor(private readonly service: PadronService) {}

  @ApiOperation({ summary: 'Consultar un CUIT en el padrón de ARCA (nombre, domicilio, estado)' })
  @Get('cuit/:cuit')
  @Roles('admin', 'superadmin')
  consultar(@Param('cuit') cuit: string, @CurrentAuth() auth: AuthPayload) {
    return this.service.consultar(cuit, auth.tenantId ?? `user:${auth.userId}`);
  }
}

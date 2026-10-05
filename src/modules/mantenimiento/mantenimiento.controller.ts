import { Controller, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { MantenimientoService } from './mantenimiento.service';
import { ClerkAuthGuard } from '../../core/auth/clerk-auth.guard';
import { RolesGuard } from '../../core/auth/roles.guard';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { ModuleGuard } from '../../shared/guards/module.guard';
import { RequireModule } from '../../shared/decorators/require-module.decorator';

/**
 * Sin rutas a propósito: el CRUD de Intervencion se eliminó en MANT-01-T1 y los
 * endpoints de planes, talleres, órdenes de trabajo y vencimientos llegan en MANT-02
 * (ver docs/mantenimiento-plan.md).
 */
@ApiTags('Mantenimiento')
@ApiBearerAuth('clerk-jwt')
@Controller('mantenimiento')
@UseGuards(ClerkAuthGuard, TenantGuard, RolesGuard, ModuleGuard)
@RequireModule('mantenimiento')
export class MantenimientoController {
  constructor(private readonly service: MantenimientoService) {}
}

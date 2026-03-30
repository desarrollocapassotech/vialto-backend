import { Controller, Get, UseGuards } from '@nestjs/common';
import { ClerkAuthGuard } from '../../core/auth/clerk-auth.guard';
import { RolesGuard } from '../../core/auth/roles.guard';
import { Roles } from '../../core/auth/roles.decorator';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { ModuleGuard } from '../../shared/guards/module.guard';
import { RequireModule } from '../../shared/decorators/require-module.decorator';
import { assertTenantId } from '../../shared/util/assert-tenant';
import { CurrentAuth } from '../../core/auth/current-auth.decorator';
import { AuthPayload } from '../../core/auth/clerk-auth.guard';

/**
 * Módulo aislado (Fase 7 — Pereyra). La entidad de turnos vive principalmente
 * en PWA/Clerk; este endpoint fija el contrato API hasta el modelo en Postgres.
 */
@Controller('turnos')
@UseGuards(ClerkAuthGuard, TenantGuard, RolesGuard, ModuleGuard)
@RequireModule('turnos')
export class TurnosController {
  @Get('estado')
  @Roles('admin', 'supervisor', 'operador', 'superadmin')
  estadoModulo(@CurrentAuth() auth: AuthPayload) {
    assertTenantId(auth.tenantId);
    return {
      modulo: 'turnos',
      fase: 7,
      postgres: 'pendiente',
      descripcion:
        'Contratos de listas de turno y asignaciones se definirán en Fase 7 (PWA).',
    };
  }
}

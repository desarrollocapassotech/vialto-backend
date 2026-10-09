import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { DashboardFinancieroService } from './dashboard-financiero.service';
import { DashboardAlertasRegistry } from './dashboard-alertas.registry';
import { TenantFieldConfigModule } from '../../core/tenant-field-config/tenant-field-config.module';

@Module({
  imports: [TenantFieldConfigModule],
  controllers: [DashboardController],
  providers: [DashboardService, DashboardFinancieroService, DashboardAlertasRegistry],
  // Los módulos vendibles registran acá sus bloques del "Resumen de alertas" (nunca al revés).
  exports: [DashboardAlertasRegistry],
})
export class DashboardModule {}

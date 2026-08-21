import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { DashboardFinancieroService } from './dashboard-financiero.service';
import { TenantFieldConfigModule } from '../../core/tenant-field-config/tenant-field-config.module';

@Module({
  imports: [TenantFieldConfigModule],
  controllers: [DashboardController],
  providers: [DashboardService, DashboardFinancieroService],
})
export class DashboardModule {}

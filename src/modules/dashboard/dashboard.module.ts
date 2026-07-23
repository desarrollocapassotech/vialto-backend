import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { DashboardFinancieroService } from './dashboard-financiero.service';

@Module({
  controllers: [DashboardController],
  providers: [DashboardService, DashboardFinancieroService],
})
export class DashboardModule {}

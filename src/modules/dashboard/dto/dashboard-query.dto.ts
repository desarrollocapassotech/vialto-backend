import { IsDateString, IsIn, ValidateIf } from 'class-validator';

export type DashboardPeriodParam = 'week' | 'month' | '3months' | 'custom';

export class DashboardQueryDto {
  @IsIn(['week', 'month', '3months', 'custom'])
  period!: DashboardPeriodParam;

  @ValidateIf((o: DashboardQueryDto) => o.period === 'custom')
  @IsDateString()
  from?: string;

  @ValidateIf((o: DashboardQueryDto) => o.period === 'custom')
  @IsDateString()
  to?: string;
}

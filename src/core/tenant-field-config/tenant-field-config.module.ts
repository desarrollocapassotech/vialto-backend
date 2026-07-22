import { Module } from '@nestjs/common';
import { TenantFieldConfigService } from './tenant-field-config.service';
import { TenantFieldConfigController } from './tenant-field-config.controller';

@Module({
  controllers: [TenantFieldConfigController],
  providers: [TenantFieldConfigService],
  exports: [TenantFieldConfigService],
})
export class TenantFieldConfigModule {}
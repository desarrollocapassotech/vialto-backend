import { Module } from '@nestjs/common';
import { TenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';
import { ProductoLabelPluralService } from './producto-label-plural.service';

@Module({
  controllers: [TenantsController],
  providers: [TenantsService, ProductoLabelPluralService],
  exports: [TenantsService],
})
export class TenantsModule {}

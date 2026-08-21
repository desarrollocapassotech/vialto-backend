import { Module } from '@nestjs/common';
import { ViajesController } from './viajes.controller';
import { ViajesService } from './viajes.service';
import { ViajesAutoEstadoService } from './viajes-auto-estado.service';
import { MicCrtService } from './mic-crt.service';
import { PautService } from './paut.service';
import { TenantFieldConfigModule } from '../../core/tenant-field-config/tenant-field-config.module';

@Module({
  imports: [TenantFieldConfigModule],
  controllers: [ViajesController],
  providers: [ViajesService, ViajesAutoEstadoService, MicCrtService, PautService],
  exports: [ViajesService, MicCrtService, PautService],
})
export class ViajesModule {}

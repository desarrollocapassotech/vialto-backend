import { Module } from '@nestjs/common';
import { ViajesController } from './viajes.controller';
import { ViajesService } from './viajes.service';
import { ViajesAutoEstadoService } from './viajes-auto-estado.service';
import { MicCrtService } from './mic-crt.service';
import { PautService } from './paut.service';

@Module({
  controllers: [ViajesController],
  providers: [ViajesService, ViajesAutoEstadoService, MicCrtService, PautService],
  exports: [ViajesService],
})
export class ViajesModule {}

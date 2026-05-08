import { Module } from '@nestjs/common';
import { ViajesController } from './viajes.controller';
import { ViajesService } from './viajes.service';
import { ViajesAutoEstadoService } from './viajes-auto-estado.service';
import { CargasController } from './cargas.controller';
import { CargasService } from './cargas.service';
import { MicCrtService } from './mic-crt.service';
import { PautService } from './paut.service';

@Module({
  controllers: [ViajesController, CargasController],
  providers: [ViajesService, ViajesAutoEstadoService, CargasService, MicCrtService, PautService],
  exports: [ViajesService, CargasService],
})
export class ViajesModule {}

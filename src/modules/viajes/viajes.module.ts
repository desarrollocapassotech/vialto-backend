import { Module } from '@nestjs/common';
import { ViajesController } from './viajes.controller';
import { ViajesService } from './viajes.service';
import { ViajesAutoEstadoService } from './viajes-auto-estado.service';
import { CargasController } from './cargas.controller';
import { CargasService } from './cargas.service';
import { MicCrtService } from './mic-crt.service';

@Module({
  controllers: [ViajesController, CargasController],
  providers: [ViajesService, ViajesAutoEstadoService, CargasService, MicCrtService],
  exports: [ViajesService, CargasService],
})
export class ViajesModule {}

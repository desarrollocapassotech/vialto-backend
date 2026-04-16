import { Module } from '@nestjs/common';
import { ViajesController } from './viajes.controller';
import { ViajesService } from './viajes.service';
import { ViajesAutoEstadoService } from './viajes-auto-estado.service';

@Module({
  controllers: [ViajesController],
  providers: [ViajesService, ViajesAutoEstadoService],
})
export class ViajesModule {}

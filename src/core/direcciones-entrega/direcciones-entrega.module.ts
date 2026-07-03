import { Module } from '@nestjs/common';
import { DireccionesEntregaController } from './direcciones-entrega.controller';
import { DireccionesEntregaService } from './direcciones-entrega.service';

@Module({
  controllers: [DireccionesEntregaController],
  providers: [DireccionesEntregaService],
  exports: [DireccionesEntregaService],
})
export class DireccionesEntregaModule {}

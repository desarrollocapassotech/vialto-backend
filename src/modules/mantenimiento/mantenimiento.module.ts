import { Module } from '@nestjs/common';
import { MantenimientoController } from './mantenimiento.controller';
import { MantenimientoService } from './mantenimiento.service';
import { PlanesService } from './planes.service';

@Module({
  controllers: [MantenimientoController],
  providers: [MantenimientoService, PlanesService],
})
export class MantenimientoModule {}

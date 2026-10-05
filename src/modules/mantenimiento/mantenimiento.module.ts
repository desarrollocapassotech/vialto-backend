import { Module } from '@nestjs/common';
import { MantenimientoController } from './mantenimiento.controller';
import { MantenimientoService } from './mantenimiento.service';
import { PlanesService } from './planes.service';
import { AsignacionesService } from './asignaciones.service';
import { TalleresService } from './talleres.service';

@Module({
  controllers: [MantenimientoController],
  providers: [MantenimientoService, PlanesService, AsignacionesService, TalleresService],
})
export class MantenimientoModule {}

import { Module } from '@nestjs/common';
import { MantenimientoController } from './mantenimiento.controller';
import { VencimientosService } from './vencimientos.service';
import { PlanesService } from './planes.service';
import { AsignacionesService } from './asignaciones.service';
import { TalleresService } from './talleres.service';
import { OrdenesService } from './ordenes.service';
import { HistorialService } from './historial.service';
import { OdometroModule } from '../../core/odometro/odometro.module';

@Module({
  imports: [OdometroModule],
  controllers: [MantenimientoController],
  providers: [VencimientosService, PlanesService, AsignacionesService, TalleresService, OrdenesService, HistorialService],
})
export class MantenimientoModule {}

import { Module } from '@nestjs/common';
import { MantenimientoController } from './mantenimiento.controller';
import { MantenimientoService } from './mantenimiento.service';
import { PlanesService } from './planes.service';
import { AsignacionesService } from './asignaciones.service';
import { TalleresService } from './talleres.service';
import { OrdenesService } from './ordenes.service';
import { OdometroModule } from '../../core/odometro/odometro.module';

@Module({
  imports: [OdometroModule],
  controllers: [MantenimientoController],
  providers: [MantenimientoService, PlanesService, AsignacionesService, TalleresService, OrdenesService],
})
export class MantenimientoModule {}

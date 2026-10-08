import { Module } from '@nestjs/common';
import { MantenimientoController } from './mantenimiento.controller';
import { VencimientosService } from './vencimientos.service';
import { PlanesService } from './planes.service';
import { AsignacionesService } from './asignaciones.service';
import { TalleresService } from './talleres.service';
import { OrdenesService } from './ordenes.service';
import { HistorialService } from './historial.service';
import { VencidoEvaluator, VencimientoProximoEvaluator } from './notificaciones/vencimientos.evaluators';
import { OdometroModule } from '../../core/odometro/odometro.module';
// Módulo transversal: Mantenimiento registra sus avisos ahí (nunca al revés).
import { NotificacionesModule } from '../notificaciones/notificaciones.module';

@Module({
  imports: [OdometroModule, NotificacionesModule],
  controllers: [MantenimientoController],
  providers: [
    VencimientosService,
    PlanesService,
    AsignacionesService,
    TalleresService,
    OrdenesService,
    HistorialService,
    VencimientoProximoEvaluator,
    VencidoEvaluator,
  ],
})
export class MantenimientoModule {}

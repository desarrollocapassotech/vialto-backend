import { Module } from '@nestjs/common';
import { MantenimientoController } from './mantenimiento.controller';
import { VencimientosService } from './vencimientos.service';
import { PlanesService } from './planes.service';
import { AsignacionesService } from './asignaciones.service';
import { TalleresService } from './talleres.service';
import { OrdenesService } from './ordenes.service';
import { HistorialService } from './historial.service';
import { VencidoEvaluator, VencimientoProximoEvaluator } from './notificaciones/vencimientos.evaluators';
import { VencimientosAlertaProveedor } from './dashboard/vencimientos-alerta.proveedor';
import { OdometroModule } from '../../core/odometro/odometro.module';
// Módulos transversales: Mantenimiento registra ahí sus avisos y su bloque de alertas (nunca al revés).
import { NotificacionesModule } from '../notificaciones/notificaciones.module';
import { DashboardModule } from '../dashboard/dashboard.module';

@Module({
  imports: [OdometroModule, NotificacionesModule, DashboardModule],
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
    VencimientosAlertaProveedor,
  ],
})
export class MantenimientoModule {}

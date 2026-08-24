import { Module } from '@nestjs/common';
import { NotificacionesController } from './notificaciones.controller';
import { NotificacionesConfigService } from './notificaciones-config.service';
import { NotificacionesCronService } from './notificaciones-cron.service';
import { NotificacionesFeedService } from './notificaciones-feed.service';
import { FacturaPorVencerEvaluator } from './evaluators/factura-por-vencer.evaluator';
import { CargaSospechosaEvaluator } from './evaluators/carga-sospechosa.evaluator';
import { EmailModule } from '../../shared/email/email.module';
import { UsersModule } from '../../core/users/users.module';

@Module({
  imports: [EmailModule, UsersModule],
  controllers: [NotificacionesController],
  providers: [
    NotificacionesConfigService,
    NotificacionesCronService,
    NotificacionesFeedService,
    FacturaPorVencerEvaluator,
    CargaSospechosaEvaluator,
  ],
  exports: [NotificacionesConfigService],
})
export class NotificacionesModule {}

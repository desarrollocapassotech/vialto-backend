import { Module } from '@nestjs/common';
import { OdometroService } from './odometro.service';

/** Lectura de km de la flota (sin endpoints propios; lo consume Mantenimiento). */
@Module({
  providers: [OdometroService],
  exports: [OdometroService],
})
export class OdometroModule {}

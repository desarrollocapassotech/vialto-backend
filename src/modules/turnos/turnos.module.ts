import { Module } from '@nestjs/common';
import { TurnosController } from './turnos.controller';

@Module({
  controllers: [TurnosController],
})
export class TurnosModule {}

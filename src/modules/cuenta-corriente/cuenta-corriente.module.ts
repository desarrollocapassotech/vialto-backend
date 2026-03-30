import { Module } from '@nestjs/common';
import { CuentaCorrienteController } from './cuenta-corriente.controller';
import { CuentaCorrienteService } from './cuenta-corriente.service';

@Module({
  controllers: [CuentaCorrienteController],
  providers: [CuentaCorrienteService],
})
export class CuentaCorrienteModule {}

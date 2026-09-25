import { Module } from '@nestjs/common';
import { CuentaCorrienteController } from './cuenta-corriente.controller';
import { CuentaCorrienteService } from './cuenta-corriente.service';
import { EstadoCuentaPdfService } from './estado-cuenta-pdf.service';
import { FacturacionModule } from '../facturacion/facturacion.module';
import { ViajesModule } from '../viajes/viajes.module';

@Module({
  imports: [FacturacionModule, ViajesModule],
  controllers: [CuentaCorrienteController],
  providers: [CuentaCorrienteService, EstadoCuentaPdfService],
})
export class CuentaCorrienteModule {}

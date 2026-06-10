import { Module } from '@nestjs/common';
import { PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';
import { ChoferesModule } from '../choferes/choferes.module';
import { VehiculosModule } from '../vehiculos/vehiculos.module';
import { ViajesModule } from '../../modules/viajes/viajes.module';
import { StockModule } from '../../modules/stock/stock.module';
import { FacturacionModule } from '../../modules/facturacion/facturacion.module';
import { IntegracionArcaModule } from '../../modules/liquidaciones-arca/liquidaciones-arca.module';

@Module({
  imports: [
    ChoferesModule,
    VehiculosModule,
    ViajesModule,
    StockModule,
    FacturacionModule,
    IntegracionArcaModule,
  ],
  controllers: [PlatformController],
  providers: [PlatformService],
})
export class PlatformModule {}

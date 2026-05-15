import { Module } from '@nestjs/common';
import { PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';
import { ViajesModule } from '../../modules/viajes/viajes.module';
import { StockModule } from '../../modules/stock/stock.module';
import { FacturacionModule } from '../../modules/facturacion/facturacion.module';
import { LiquidacionesArcaModule } from '../../modules/liquidaciones-arca/liquidaciones-arca.module';

@Module({
  imports: [ViajesModule, StockModule, FacturacionModule, LiquidacionesArcaModule],
  controllers: [PlatformController],
  providers: [PlatformService],
})
export class PlatformModule {}

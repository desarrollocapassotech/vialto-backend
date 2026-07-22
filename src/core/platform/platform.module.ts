import { Module } from '@nestjs/common';
import { PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';
import { ChoferesModule } from '../choferes/choferes.module';
import { DestinatariosModule } from '../destinatarios/destinatarios.module';
import { DireccionesEntregaModule } from '../direcciones-entrega/direcciones-entrega.module';
import { VehiculosModule } from '../vehiculos/vehiculos.module';
import { ViajesModule } from '../../modules/viajes/viajes.module';
import { StockModule } from '../../modules/stock/stock.module';
import { FacturacionModule } from '../../modules/facturacion/facturacion.module';
import { IntegracionArcaModule } from '../../modules/liquidaciones-arca/liquidaciones-arca.module';
import { TenantFieldConfigModule } from '../tenant-field-config/tenant-field-config.module';

@Module({
  imports: [
    ChoferesModule,
    DestinatariosModule,
    DireccionesEntregaModule,
    VehiculosModule,
    ViajesModule,
    StockModule,
    FacturacionModule,
    IntegracionArcaModule,
    TenantFieldConfigModule,
  ],
  controllers: [PlatformController],
  providers: [PlatformService],
})
export class PlatformModule {}

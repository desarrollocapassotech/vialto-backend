import { Module } from '@nestjs/common';
import { ImportacionesController } from './importaciones.controller';
import { ImportacionesService } from './importaciones.service';
import { ImportacionesPostViajesService } from './importaciones-post-viajes.service';
import { ParserService } from './engine/parser.service';
import { ValidatorService } from './engine/validator.service';
import { ViajesProcessor } from './processors/viajes.processor';
import { ClientesProcessor } from './processors/clientes.processor';
import { TransportistasProcessor } from './processors/transportistas.processor';
import { ChoferesProcessor } from './processors/choferes.processor';
import { VehiculosProcessor } from './processors/vehiculos.processor';
import { VehiculosModule } from '../../core/vehiculos/vehiculos.module';
import { IntegracionArcaModule } from '../liquidaciones-arca/liquidaciones-arca.module';
import { FacturacionModule } from '../facturacion/facturacion.module';

@Module({
  imports: [VehiculosModule, IntegracionArcaModule, FacturacionModule],
  controllers: [ImportacionesController],
  providers: [
    ImportacionesService,
    ImportacionesPostViajesService,
    ParserService,
    ValidatorService,
    ViajesProcessor,
    ClientesProcessor,
    TransportistasProcessor,
    ChoferesProcessor,
    VehiculosProcessor,
  ],
})
export class ImportacionesModule {}

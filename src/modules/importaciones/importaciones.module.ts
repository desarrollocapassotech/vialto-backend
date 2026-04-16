import { Module } from '@nestjs/common';
import { ImportacionesController } from './importaciones.controller';
import { ImportacionesService } from './importaciones.service';
import { ParserService } from './engine/parser.service';
import { ValidatorService } from './engine/validator.service';
import { ViajesProcessor } from './processors/viajes.processor';
import { ClientesProcessor } from './processors/clientes.processor';

@Module({
  controllers: [ImportacionesController],
  providers: [
    ImportacionesService,
    ParserService,
    ValidatorService,
    ViajesProcessor,
    ClientesProcessor,
  ],
})
export class ImportacionesModule {}

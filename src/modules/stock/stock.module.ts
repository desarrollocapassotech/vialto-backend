import { Module } from '@nestjs/common';
import { StockController } from './stock.controller';
import { StockService } from './stock.service';
import { RemitoInternoPdfService } from './remito-interno-pdf.service';
import { NombresUsuariosService } from '../../shared/usuarios/nombres-usuarios.service';

@Module({
  controllers: [StockController],
  providers: [StockService, RemitoInternoPdfService, NombresUsuariosService],
  exports: [StockService],
})
export class StockModule {}

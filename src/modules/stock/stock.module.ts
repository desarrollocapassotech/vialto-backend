import { Module } from '@nestjs/common';
import { StockController } from './stock.controller';
import { StockService } from './stock.service';
import { RemitoInternoPdfService } from './remito-interno-pdf.service';

@Module({
  controllers: [StockController],
  providers: [StockService, RemitoInternoPdfService],
  exports: [StockService],
})
export class StockModule {}

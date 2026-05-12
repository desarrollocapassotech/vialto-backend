import { Module } from '@nestjs/common';
import { PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';
import { ViajesModule } from '../../modules/viajes/viajes.module';
import { StockModule } from '../../modules/stock/stock.module';

@Module({
  imports: [ViajesModule, StockModule],
  controllers: [PlatformController],
  providers: [PlatformService],
})
export class PlatformModule {}

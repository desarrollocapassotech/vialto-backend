import { Module } from '@nestjs/common';
import { PrismaModule } from '../../shared/prisma/prisma.module';
import { ArcaClientService } from './arca-client.service';
import { ArcaConfigService } from './arca-config.service';
import { LiquidacionesService } from './liquidaciones.service';
import { LiquidacionesController } from './liquidaciones.controller';
import { LiquidacionPdfService } from './liquidacion-pdf.service';

@Module({
  imports: [PrismaModule],
  controllers: [LiquidacionesController],
  providers: [ArcaClientService, ArcaConfigService, LiquidacionesService, LiquidacionPdfService],
  exports: [ArcaConfigService, LiquidacionesService, LiquidacionPdfService],
})
export class IntegracionArcaModule {}

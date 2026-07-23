import { Module, OnModuleInit } from '@nestjs/common';
import { PrismaModule } from '../../shared/prisma/prisma.module';
import { ArcaClientService } from './arca-client.service';
import { ArcaConfigService } from './arca-config.service';
import { LiquidacionesService } from './liquidaciones.service';
import { LiquidacionesController } from './liquidaciones.controller';
import { LiquidacionPdfService } from './liquidacion-pdf.service';
import { ConceptosLiquidacionService } from './conceptos-liquidacion.service';

@Module({
  imports: [PrismaModule],
  controllers: [LiquidacionesController],
  providers: [
    ArcaClientService,
    ArcaConfigService,
    LiquidacionesService,
    LiquidacionPdfService,
    ConceptosLiquidacionService,
  ],
  exports: [
    ArcaConfigService,
    LiquidacionesService,
    LiquidacionPdfService,
    ConceptosLiquidacionService,
  ],
})
export class IntegracionArcaModule implements OnModuleInit {
  constructor(private readonly configService: ArcaConfigService) {}

  async onModuleInit() {
    try {
      await this.configService.migrateExistingConfigs();
    } catch (error) {
      console.error(
        `[IntegracionArcaModule] Error crítico no controlado durante la migración de certificados ARCA: ${error.message}`,
      );
    }
  }
}

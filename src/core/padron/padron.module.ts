import { Module } from '@nestjs/common';
import { PadronController } from './padron.controller';
import { PadronService } from './padron.service';
import { PadronValidacionService } from './padron-validacion.service';

@Module({
  controllers: [PadronController],
  providers: [PadronService, PadronValidacionService],
})
export class PadronModule {}

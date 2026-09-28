import { Module } from '@nestjs/common';
import { PadronController } from './padron.controller';
import { PadronService } from './padron.service';

@Module({
  controllers: [PadronController],
  providers: [PadronService],
})
export class PadronModule {}

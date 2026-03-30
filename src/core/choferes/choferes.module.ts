import { Module } from '@nestjs/common';
import { ChoferesController } from './choferes.controller';
import { ChoferesService } from './choferes.service';

@Module({
  controllers: [ChoferesController],
  providers: [ChoferesService],
})
export class ChoferesModule {}

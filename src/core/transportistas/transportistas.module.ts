import { Module } from '@nestjs/common';
import { TransportistasController } from './transportistas.controller';
import { TransportistasService } from './transportistas.service';

@Module({
  controllers: [TransportistasController],
  providers: [TransportistasService],
  exports: [TransportistasService],
})
export class TransportistasModule {}

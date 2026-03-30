import { Module } from '@nestjs/common';
import { RemitosController } from './remitos.controller';
import { RemitosService } from './remitos.service';

@Module({
  controllers: [RemitosController],
  providers: [RemitosService],
})
export class RemitosModule {}

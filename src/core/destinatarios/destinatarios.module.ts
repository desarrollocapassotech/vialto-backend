import { Module } from '@nestjs/common';
import { DestinatariosController } from './destinatarios.controller';
import { DestinatariosService } from './destinatarios.service';

@Module({
  controllers: [DestinatariosController],
  providers: [DestinatariosService],
  exports: [DestinatariosService],
})
export class DestinatariosModule {}

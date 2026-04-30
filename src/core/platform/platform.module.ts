import { Module } from '@nestjs/common';
import { PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';
import { ViajesModule } from '../../modules/viajes/viajes.module';

@Module({
  imports: [ViajesModule],
  controllers: [PlatformController],
  providers: [PlatformService],
})
export class PlatformModule {}

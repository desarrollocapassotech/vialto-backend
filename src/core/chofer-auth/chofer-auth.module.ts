import { Module } from '@nestjs/common';
import { ChoferAuthController } from './chofer-auth.controller';
import { ChoferAuthService } from './chofer-auth.service';

@Module({
  controllers: [ChoferAuthController],
  providers: [ChoferAuthService],
})
export class ChoferAuthModule {}

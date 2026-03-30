import { Global, Module } from '@nestjs/common';
import { ModuleGuard } from './guards/module.guard';
import { TenantGuard } from './guards/tenant.guard';
import { FirebaseAdminService } from './firebase/firebase-admin.service';
import { CloudinaryService } from './storage/cloudinary.service';

@Global()
@Module({
  providers: [
    ModuleGuard,
    TenantGuard,
    FirebaseAdminService,
    CloudinaryService,
  ],
  exports: [
    ModuleGuard,
    TenantGuard,
    FirebaseAdminService,
    CloudinaryService,
  ],
})
export class VialtoSharedModule {}

import { Module } from "@nestjs/common";
import { CombustibleController } from "./combustible.controller";
import { CombustibleTenantController } from "./combustible-tenant.controller";
import { CombustibleService } from "./combustible.service";
import { ChoferCombustibleController } from "./chofer-combustible.controller";
import { ChoferAuthGuard } from "../../core/chofer-auth/chofer-auth.guard";
import { CombustibleCorreccionCronService } from "./combustible-correccion-cron.service";

@Module({
  // ChoferCombustibleController primero: sus rutas estáticas ganan sobre :id de CombustibleController
  controllers: [ChoferCombustibleController, CombustibleTenantController, CombustibleController],
  providers: [CombustibleService, ChoferAuthGuard, CombustibleCorreccionCronService],
})
export class CombustibleModule {}

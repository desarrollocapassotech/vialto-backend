import { Module } from "@nestjs/common";
import { CombustibleController } from "./combustible.controller";
import { CombustibleService } from "./combustible.service";
import { ChoferCombustibleController } from "./chofer-combustible.controller";
import { ChoferAuthGuard } from "../../core/chofer-auth/chofer-auth.guard";

@Module({
  // ChoferCombustibleController primero: sus rutas estáticas ganan sobre :id de CombustibleController
  controllers: [ChoferCombustibleController, CombustibleController],
  providers: [CombustibleService, ChoferAuthGuard],
})
export class CombustibleModule {}

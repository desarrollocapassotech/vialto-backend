import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './shared/prisma/prisma.module';
import { AuthModule } from './core/auth/auth.module';
import { VialtoSharedModule } from './shared/vialto-shared.module';
import { TenantsModule } from './core/tenants/tenants.module';
import { UsersModule } from './core/users/users.module';
import { BillingModule } from './core/billing/billing.module';
import { ClientesModule } from './core/clientes/clientes.module';
import { TransportistasModule } from './core/transportistas/transportistas.module';
import { ChoferesModule } from './core/choferes/choferes.module';
import { VehiculosModule } from './core/vehiculos/vehiculos.module';
import { ViajesModule } from './modules/viajes/viajes.module';
import { FacturacionModule } from './modules/facturacion/facturacion.module';
import { CuentaCorrienteModule } from './modules/cuenta-corriente/cuenta-corriente.module';
import { StockModule } from './modules/stock/stock.module';
import { CombustibleModule } from './modules/combustible/combustible.module';
import { MantenimientoModule } from './modules/mantenimiento/mantenimiento.module';
import { RemitosModule } from './modules/remitos/remitos.module';
import { TurnosModule } from './modules/turnos/turnos.module';
import { ReportesModule } from './modules/reportes/reportes.module';
import { ImportacionesModule } from './modules/importaciones/importaciones.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { HealthController } from './health.controller';
import { PlatformModule } from './core/platform/platform.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    VialtoSharedModule,
    TenantsModule,
    UsersModule,
    BillingModule,
    ClientesModule,
    TransportistasModule,
    ChoferesModule,
    VehiculosModule,
    ViajesModule,
    FacturacionModule,
    CuentaCorrienteModule,
    StockModule,
    CombustibleModule,
    MantenimientoModule,
    RemitosModule,
    TurnosModule,
    ReportesModule,
    ImportacionesModule,
    DashboardModule,
    PlatformModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}

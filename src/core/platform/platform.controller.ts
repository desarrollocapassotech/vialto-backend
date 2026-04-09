import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { PlatformService } from './platform.service';
import { CreateClienteDto } from '../clientes/dto/create-cliente.dto';
import { UpdateClienteDto } from '../clientes/dto/update-cliente.dto';
import { CreateChoferDto } from '../choferes/dto/create-chofer.dto';
import { UpdateChoferDto } from '../choferes/dto/update-chofer.dto';
import { CreateVehiculoDto } from '../vehiculos/dto/create-vehiculo.dto';
import { UpdateVehiculoDto } from '../vehiculos/dto/update-vehiculo.dto';
import { CreateTransportistaDto } from '../transportistas/dto/create-transportista.dto';
import { UpdateTransportistaDto } from '../transportistas/dto/update-transportista.dto';
import { CreateViajeDto } from '../../modules/viajes/dto/create-viaje.dto';
import { UpdateViajeDto } from '../../modules/viajes/dto/update-viaje.dto';
import { CurrentAuth } from '../auth/current-auth.decorator';
import { AuthPayload } from '../auth/clerk-auth.guard';

/**
 * Datos por tenant (query `tenantId` = clerkOrgId) — solo superadmin.
 * Sin `tenantId` la respuesta es lista vacía.
 */
@Controller('platform')
@UseGuards(ClerkAuthGuard, RolesGuard)
@Roles('superadmin')
export class PlatformController {
  constructor(private readonly service: PlatformService) {}

  @Get('viajes')
  viajes(@Query('tenantId') tenantId?: string) {
    return this.service.listViajes(tenantId);
  }

  @Get('viajes/:id')
  viajeById(@Param('id') id: string, @Query('tenantId') tenantId?: string) {
    return this.service.getViajeById(tenantId, id);
  }

  @Post('viajes')
  createViaje(
    @Query('tenantId') tenantId: string | undefined,
    @Body() dto: CreateViajeDto,
    @CurrentAuth() auth: AuthPayload,
  ) {
    return this.service.createViaje(tenantId, dto, auth.userId);
  }

  @Patch('viajes/:id')
  updateViaje(
    @Param('id') id: string,
    @Query('tenantId') tenantId: string | undefined,
    @Body() dto: UpdateViajeDto,
  ) {
    return this.service.updateViaje(tenantId, id, dto);
  }

  @Delete('viajes/:id')
  removeViaje(@Param('id') id: string, @Query('tenantId') tenantId?: string) {
    return this.service.removeViaje(tenantId, id);
  }

  @Get('clientes')
  clientes(@Query('tenantId') tenantId?: string) {
    return this.service.listClientes(tenantId);
  }

  @Get('clientes/:id')
  clienteById(@Param('id') id: string, @Query('tenantId') tenantId?: string) {
    return this.service.getClienteById(tenantId, id);
  }

  @Post('clientes')
  createCliente(
    @Query('tenantId') tenantId: string | undefined,
    @Body() dto: CreateClienteDto,
  ) {
    return this.service.createCliente(tenantId, dto);
  }

  @Patch('clientes/:id')
  updateCliente(
    @Param('id') id: string,
    @Query('tenantId') tenantId: string | undefined,
    @Body() dto: UpdateClienteDto,
  ) {
    return this.service.updateCliente(tenantId, id, dto);
  }

  @Delete('clientes/:id')
  removeCliente(@Param('id') id: string, @Query('tenantId') tenantId?: string) {
    return this.service.removeCliente(tenantId, id);
  }

  @Get('choferes')
  choferes(@Query('tenantId') tenantId?: string) {
    return this.service.listChoferes(tenantId);
  }

  @Get('choferes/:id')
  choferById(@Param('id') id: string, @Query('tenantId') tenantId?: string) {
    return this.service.getChoferById(tenantId, id);
  }

  @Post('choferes')
  createChofer(
    @Query('tenantId') tenantId: string | undefined,
    @Body() dto: CreateChoferDto,
  ) {
    return this.service.createChofer(tenantId, dto);
  }

  @Patch('choferes/:id')
  updateChofer(
    @Param('id') id: string,
    @Query('tenantId') tenantId: string | undefined,
    @Body() dto: UpdateChoferDto,
  ) {
    return this.service.updateChofer(tenantId, id, dto);
  }

  @Delete('choferes/:id')
  removeChofer(@Param('id') id: string, @Query('tenantId') tenantId?: string) {
    return this.service.removeChofer(tenantId, id);
  }

  @Get('vehiculos')
  vehiculos(@Query('tenantId') tenantId?: string) {
    return this.service.listVehiculos(tenantId);
  }

  @Get('transportistas')
  transportistas(@Query('tenantId') tenantId?: string) {
    return this.service.listTransportistas(tenantId);
  }

  @Get('transportistas/:id')
  transportistaById(@Param('id') id: string, @Query('tenantId') tenantId?: string) {
    return this.service.getTransportistaById(tenantId, id);
  }

  @Post('transportistas')
  createTransportista(
    @Query('tenantId') tenantId: string | undefined,
    @Body() dto: CreateTransportistaDto,
  ) {
    return this.service.createTransportista(tenantId, dto);
  }

  @Patch('transportistas/:id')
  updateTransportista(
    @Param('id') id: string,
    @Query('tenantId') tenantId: string | undefined,
    @Body() dto: UpdateTransportistaDto,
  ) {
    return this.service.updateTransportista(tenantId, id, dto);
  }

  @Delete('transportistas/:id')
  removeTransportista(@Param('id') id: string, @Query('tenantId') tenantId?: string) {
    return this.service.removeTransportista(tenantId, id);
  }

  @Get('users')
  users(@Query('tenantId') tenantId?: string) {
    return this.service.listUsers(tenantId);
  }

  @Get('users/:userId')
  userById(@Param('userId') userId: string, @Query('tenantId') tenantId?: string) {
    return this.service.getUserById(tenantId, userId);
  }

  @Post('users/invite')
  inviteUser(
    @Query('tenantId') tenantId: string | undefined,
    @Body('name') name: string,
    @Body('email') email: string,
    @Body('password') password: string,
    @Body('role') role: string,
  ) {
    return this.service.inviteUser(tenantId, name, email, password, role);
  }

  @Patch('users/:userId/role')
  updateUserRole(
    @Param('userId') userId: string,
    @Query('tenantId') tenantId: string | undefined,
    @Body('role') role: string,
  ) {
    return this.service.updateUserRole(tenantId, userId, role);
  }

  @Delete('users/:userId')
  removeUser(@Param('userId') userId: string, @Query('tenantId') tenantId?: string) {
    return this.service.removeUser(tenantId, userId);
  }

  @Get('vehiculos/:id')
  vehiculoById(@Param('id') id: string, @Query('tenantId') tenantId?: string) {
    return this.service.getVehiculoById(tenantId, id);
  }

  @Post('vehiculos')
  createVehiculo(
    @Query('tenantId') tenantId: string | undefined,
    @Body() dto: CreateVehiculoDto,
  ) {
    return this.service.createVehiculo(tenantId, dto);
  }

  @Patch('vehiculos/:id')
  updateVehiculo(
    @Param('id') id: string,
    @Query('tenantId') tenantId: string | undefined,
    @Body() dto: UpdateVehiculoDto,
  ) {
    return this.service.updateVehiculo(tenantId, id, dto);
  }

  @Delete('vehiculos/:id')
  removeVehiculo(@Param('id') id: string, @Query('tenantId') tenantId?: string) {
    return this.service.removeVehiculo(tenantId, id);
  }

  // ── Facturación ────────────────────────────────────────────────────────────

  @Get('facturas')
  facturas(@Query('tenantId') tenantId?: string) {
    return this.service.listFacturas(tenantId);
  }

  @Post('facturas')
  createFactura(
    @Query('tenantId') tenantId: string | undefined,
    @Body()
    body: {
      numero: string;
      tipo: string;
      clienteId?: string;
      viajeId?: string;
      importe: number;
      fechaEmision: string;
      fechaVencimiento?: string;
      estado?: string;
    },
  ) {
    return this.service.createFactura(tenantId, body);
  }

  @Delete('facturas/:id')
  removeFactura(@Param('id') id: string, @Query('tenantId') tenantId?: string) {
    return this.service.removeFactura(tenantId, id);
  }

  @Patch('facturas/:id')
  updateFactura(
    @Param('id') id: string,
    @Query('tenantId') tenantId: string | undefined,
    @Body() body: { estado?: string; fechaVencimiento?: string | null },
  ) {
    return this.service.updateFactura(tenantId, id, body);
  }

  @Post('pagos')
  createPago(
    @Query('tenantId') tenantId: string | undefined,
    @Body() body: { facturaId: string; importe: number; fecha: string; formaPago?: string },
  ) {
    return this.service.createPago(tenantId, body);
  }

  @Delete('pagos/:id')
  deletePago(@Param('id') id: string, @Query('tenantId') tenantId?: string) {
    return this.service.deletePago(tenantId, id);
  }
}

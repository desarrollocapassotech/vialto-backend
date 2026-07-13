import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CreateCargaChoferDto } from './dto/create-carga-chofer.dto';
import { UpdateCargaChoferDto } from './dto/update-carga-chofer.dto';
import {
  ChoferAuthGuard,
  ChoferAuthRequest,
} from '../../core/chofer-auth/chofer-auth.guard';
import { CombustibleService } from './combustible.service';

/**
 * Endpoints del módulo combustible accesibles por choferes de la app vialto-combustible.
 * Usan el JWT propio del backend (ChoferAuthGuard), no Clerk.
 */
@ApiTags('Auth — App Combustible (chofer)')
@Controller('combustible/chofer')
@UseGuards(ChoferAuthGuard)
export class ChoferCombustibleController {
  constructor(private readonly service: CombustibleService) {}

  @ApiOperation({
    summary: 'Cargas del chofer autenticado · filtro opcional por mes (YYYY-MM)',
  })
  @Get('mis-cargas')
  getMisCargas(
    @Req() req: ChoferAuthRequest,
    @Query('month') month?: string,
  ) {
    const { sub: choferId, tenantId } = req.choferAuth;
    return this.service.findAllByChofer(choferId, tenantId, month);
  }

  @ApiOperation({ summary: 'Última carga del chofer (sin filtro de mes) — para default de patente' })
  @Get('ultima-carga')
  getUltimaCarga(@Req() req: ChoferAuthRequest) {
    const { sub: choferId, tenantId } = req.choferAuth;
    return this.service.getUltimaCargaChofer(choferId, tenantId);
  }

  @ApiOperation({ summary: 'Último km registrado para un vehículo (por patente)' })
  @Get('ultimo-km')
  getUltimoKm(
    @Req() req: ChoferAuthRequest,
    @Query('patente') patente: string,
    @Query('excludeId') excludeId?: string,
  ) {
    const { tenantId } = req.choferAuth;
    return this.service.getUltimoKmPorPatente(patente, tenantId, excludeId);
  }

  @ApiOperation({ summary: 'Registrar una carga de combustible (usa patente en lugar de vehiculoId)' })
  @Post('cargas')
  createCarga(
    @Req() req: ChoferAuthRequest,
    @Body() dto: CreateCargaChoferDto,
  ) {
    const { sub: choferId, tenantId } = req.choferAuth;
    return this.service.createByChofer(dto, choferId, tenantId);
  }

  @ApiOperation({ summary: 'Eliminar una carga propia (solo el chofer que la creó)' })
  @Delete('cargas/:id')
  deleteCarga(
    @Req() req: ChoferAuthRequest,
    @Param('id') id: string,
  ) {
    const { sub: choferId, tenantId } = req.choferAuth;
    return this.service.deleteByChofer(id, choferId, tenantId);
  }

  @ApiOperation({ summary: 'Editar una carga propia (solo el chofer que la creó)' })
  @Patch('cargas/:id')
  updateCarga(
    @Req() req: ChoferAuthRequest,
    @Param('id') id: string,
    @Body() dto: UpdateCargaChoferDto,
  ) {
    const { sub: choferId, tenantId } = req.choferAuth;
    return this.service.updateByChofer(id, dto, choferId, tenantId);
  }
}

import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CreateCargaChoferDto } from './dto/create-carga-chofer.dto';
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

  @ApiOperation({ summary: 'Registrar una carga de combustible (usa patente en lugar de vehiculoId)' })
  @Post('cargas')
  createCarga(
    @Req() req: ChoferAuthRequest,
    @Body() dto: CreateCargaChoferDto,
  ) {
    const { sub: choferId, tenantId } = req.choferAuth;
    return this.service.createByChofer(dto, choferId, tenantId);
  }
}

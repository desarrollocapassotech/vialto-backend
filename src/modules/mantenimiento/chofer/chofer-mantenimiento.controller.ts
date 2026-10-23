import { Body, Controller, Get, Post, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ChoferAuthGuard, ChoferAuthRequest } from '../../../core/chofer-auth/chofer-auth.guard';
import { ChoferMantenimientoService } from './chofer-mantenimiento.service';
import { RegistrarServiceChoferDto } from './registrar-service-chofer.dto';

/**
 * Mantenimiento desde la app de Combustible (chofer, JWT propio vía `ChoferAuthGuard`, no Clerk).
 * El tenant y el chofer salen del token; el vehículo, de su asignación activa.
 */
@ApiTags('Auth — App Combustible (chofer)')
@Controller('mantenimiento/chofer')
@UseGuards(ChoferAuthGuard)
export class ChoferMantenimientoController {
  constructor(private readonly service: ChoferMantenimientoService) {}

  @ApiOperation({
    summary: 'Si el chofer puede registrar un service: módulo habilitado, vehículo asignado, km actual y sus planes',
  })
  @Get('contexto')
  contexto(@Req() req: ChoferAuthRequest) {
    const { sub: choferId, tenantId } = req.choferAuth;
    return this.service.contexto(tenantId, choferId);
  }

  @ApiOperation({ summary: 'Subir una foto del service — devuelve la URL para mandar en `adjuntos`' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @Post('fotos')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }))
  subirFoto(@Req() req: ChoferAuthRequest, @UploadedFile() file: Express.Multer.File | undefined) {
    return this.service.subirFoto(req.choferAuth.tenantId, file);
  }

  @ApiOperation({ summary: 'Registrar un service del vehículo asignado (queda como orden de trabajo)' })
  @Post('services')
  registrar(@Req() req: ChoferAuthRequest, @Body() dto: RegistrarServiceChoferDto) {
    const { sub: choferId, tenantId } = req.choferAuth;
    return this.service.registrar(tenantId, choferId, dto);
  }
}

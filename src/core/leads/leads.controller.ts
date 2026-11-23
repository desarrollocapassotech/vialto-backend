import { Body, Controller, HttpCode, HttpException, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CreateLeadDto } from './dto/create-lead.dto';
import { LeadsService } from './leads.service';

const VENTANA_MS = 10 * 60 * 1000;
const MAX_POR_VENTANA = 5;

/**
 * Formulario de contacto de la landing. **Público a propósito** (sin ClerkAuthGuard):
 * lo completan personas sin cuenta. No toca la base ni datos de ningún tenant.
 * Protección anti-spam: campo trampa (`sitio`) + límite simple por IP en memoria.
 */
@ApiTags('Sistema')
@Controller('leads')
export class LeadsController {
  private readonly intentos = new Map<string, number[]>();

  constructor(private readonly leads: LeadsService) {}

  @ApiOperation({ summary: 'Recibir un interesado desde la landing y avisar por mail' })
  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  async crear(@Body() dto: CreateLeadDto, @Req() req: Request): Promise<void> {
    if (dto.sitio) return; // bot: se responde OK sin mandar nada

    this.limitar(this.ip(req));
    await this.leads.registrar(dto);
  }

  private ip(req: Request): string {
    const fwd = req.headers['x-forwarded-for'];
    const primera = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim();
    return primera || req.ip || 'desconocida';
  }

  private limitar(ip: string) {
    const ahora = Date.now();
    const recientes = (this.intentos.get(ip) ?? []).filter((t) => ahora - t < VENTANA_MS);
    if (recientes.length >= MAX_POR_VENTANA) {
      throw new HttpException(
        'Ya recibimos varios envíos desde tu conexión. Probá de nuevo en unos minutos.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    recientes.push(ahora);
    this.intentos.set(ip, recientes);
    if (this.intentos.size > 5000) {
      for (const [k, v] of this.intentos) {
        if (!v.some((t) => ahora - t < VENTANA_MS)) this.intentos.delete(k);
      }
    }
  }
}

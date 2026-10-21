import {
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PadronService } from '../../core/padron/padron.service';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { cuitDigitoVerificadorValido, normalizarCuit } from '../../shared/util/cuit';

/** Antigüedad máxima de la consulta al padrón para emitir: un CUIT puede pasar a apócrifo en cualquier momento. */
const MAX_AGE_EMISION_MS = 24 * 60 * 60 * 1000;

type ReceptorFiscal = {
  id?: string | null;
  nombre?: string | null;
  idFiscal: string | null;
  pais: string | null;
};

/**
 * Antes de emitir un comprobante en producción, verifica en el padrón de ARCA que el CUIT
 * del receptor esté activo (ej. no marcado como apócrifo). Corre solo dentro de los flujos
 * de emisión, que ya exigen `emision-facturas-arca` / `emision-liquido-producto-arca`; no
 * depende del opt-in `Tenant.validacionCuitArcaHabilitada` ni de la huella de "validado".
 *
 * Si ARCA no responde (o se agotó la cuota), no bloquea: la emisión sigue y decide WSFE.
 */
@Injectable()
export class ReceptorPadronService {
  private readonly logger = new Logger(ReceptorPadronService.name);

  constructor(
    private readonly padron: PadronService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Mismo chequeo que la emisión, pero sin tirar: lo usa el front para deshabilitar
   * "Emitir" antes de intentarlo. Lee el ambiente de la config ARCA del tenant.
   */
  async verificarRegistro(
    tenantId: string,
    entidad: 'clientes' | 'transportistas',
    id: string,
  ): Promise<{ bloqueado: false } | { bloqueado: true; mensaje: string }> {
    const receptor =
      entidad === 'clientes'
        ? await this.prisma.cliente.findFirst({
            where: { id, tenantId },
            select: { id: true, nombre: true, idFiscal: true, pais: true },
          })
        : await this.prisma.transportista.findFirst({
            where: { id, tenantId },
            select: { id: true, nombre: true, idFiscal: true, pais: true },
          });
    if (!receptor) {
      throw new NotFoundException(entidad === 'clientes' ? 'Cliente no encontrado' : 'Transportista no encontrado');
    }
    const config = await this.prisma.arcaConfig.findUnique({
      where: { tenantId },
      select: { ambiente: true },
    });
    try {
      await this.assertReceptorActivo(
        tenantId,
        config?.ambiente ?? 'homologacion',
        receptor,
        entidad === 'clientes' ? 'cliente' : 'transportista',
      );
      return { bloqueado: false };
    } catch (err) {
      if (!(err instanceof UnprocessableEntityException)) throw err;
      return { bloqueado: true, mensaje: (err.getResponse() as { message: string }).message };
    }
  }

  async assertReceptorActivo(
    tenantId: string,
    ambiente: string,
    receptor: ReceptorFiscal,
    rol: 'cliente' | 'transportista',
  ): Promise<void> {
    // En homologación se emite con el CUIT de prueba de AFIP SDK: no aplica. Salvo que
    // PADRON_CHEQUEO_RECEPTOR_HOMOLOGACION=true (solo en el backend de QA, para probarlo).
    if (ambiente !== 'produccion' && process.env.PADRON_CHEQUEO_RECEPTOR_HOMOLOGACION !== 'true') {
      return;
    }

    const pais = (receptor.pais ?? '').trim().toUpperCase();
    if (pais !== '' && pais !== 'AR' && pais !== 'ARGENTINA') return;
    const cuit = normalizarCuit(receptor.idFiscal ?? '');
    // Sin CUIT válido (ej. consumidor final) no hay nada que consultar.
    if (!cuitDigitoVerificadorValido(cuit)) return;

    let estado: string;
    let observaciones: string[];
    try {
      const consulta = await this.padron.consultar(cuit, tenantId, {
        maxAgeMs: MAX_AGE_EMISION_MS,
      });
      estado = consulta.estado;
      observaciones = consulta.observaciones;
    } catch (err) {
      const status = err instanceof HttpException ? err.getStatus() : undefined;
      this.logger.warn(
        `No se pudo verificar en el padrón el CUIT ${cuit} (tenant ${tenantId}, status ${status ?? 'n/a'}); se emite igual.`,
      );
      return;
    }

    if (estado !== 'inactivo' && estado !== 'no_encontrado') return;

    // Si el registro figuraba como validado, deja de figurar como validado al estar dado de baja o no existir.
    if (receptor.id) {
      const data = { arcaValidadoHuella: null, arcaValidadoAt: null };
      if (rol === 'cliente') {
        await this.prisma.cliente.updateMany({ where: { id: receptor.id, tenantId }, data });
      } else {
        await this.prisma.transportista.updateMany({ where: { id: receptor.id, tenantId }, data });
      }
    }

    const quien = rol === 'cliente' ? 'del cliente' : 'del transportista';
    const cuitDisplay =
      cuit.length === 11
        ? `${cuit.slice(0, 2)}-${cuit.slice(2, 10)}-${cuit.slice(10)}`
        : receptor.idFiscal?.trim() || cuit;
    const motivo =
      estado === 'no_encontrado'
        ? 'no existe en ARCA'
        : 'está dado de baja en ARCA (contribuyente no confiable / apócrifo)';
    throw new UnprocessableEntityException({
      message: `No se puede emitir: el CUIT ${cuitDisplay} ${quien} ${motivo}.`,
      detalle: { cuit, estadoPadron: estado, observaciones },
    });
  }
}

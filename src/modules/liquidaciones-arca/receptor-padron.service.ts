import { HttpException, Injectable, Logger, UnprocessableEntityException } from '@nestjs/common';
import { PadronService } from '../../core/padron/padron.service';
import { cuitDigitoVerificadorValido, normalizarCuit } from '../../shared/util/cuit';

/** Antigüedad máxima de la consulta al padrón para emitir: un CUIT puede pasar a apócrifo en cualquier momento. */
const MAX_AGE_EMISION_MS = 24 * 60 * 60 * 1000;

type ReceptorFiscal = {
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

  constructor(private readonly padron: PadronService) {}

  async assertReceptorActivo(
    tenantId: string,
    ambiente: string,
    receptor: ReceptorFiscal,
    rol: 'cliente' | 'transportista',
  ): Promise<void> {
    // En homologación se emite con el CUIT de prueba de AFIP SDK: no aplica.
    if (ambiente !== 'produccion') return;

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

    const quien = rol === 'cliente' ? 'del cliente' : 'del transportista';
    const nombre = receptor.nombre ? ` (${receptor.nombre})` : '';
    const motivo =
      estado === 'no_encontrado'
        ? 'no figura en el padrón de ARCA'
        : 'está inactivo, limitado o cancelado en ARCA (por ejemplo, marcado como apócrifo / contribuyente no confiable)';
    throw new UnprocessableEntityException({
      message: `No se puede emitir: el CUIT ${quien}${nombre} ${cuit} ${motivo}. Revisá el CUIT o consultá con el receptor.`,
      detalle: { cuit, estadoPadron: estado, observaciones },
    });
  }
}

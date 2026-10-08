import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { cuitDigitoVerificadorValido, normalizarCuit } from '../../shared/util/cuit';
import { PadronService } from './padron.service';
import { PadronConsulta } from './padron.types';

export type PadronEntidad = 'clientes' | 'transportistas';

/** Dato del registro que no coincide con lo que informa ARCA. */
export type PadronDiferencia = 'condicionIva' | 'domicilio';

export type PadronValidacionResultado =
  /** Sin CUIT argentino válido: no hay nada que validar. */
  | { resultado: 'no_aplica' }
  /** Coincide con ARCA. `desdeMarca` = no se consultó: ya estaba validado con estos mismos datos. */
  | { resultado: 'validado'; validadoAt: Date; desdeMarca: boolean }
  /** CUIT activo pero condición IVA / domicilio distintos (o vacíos): el front precarga lo de ARCA. */
  | { resultado: 'diferencias'; padron: PadronConsulta; diferencias: PadronDiferencia[] }
  /** CUIT inactivo o inexistente en el padrón. */
  | { resultado: 'rechazado'; padron: PadronConsulta };

type DatosFiscales = {
  idFiscal: string | null;
  pais: string | null;
  condicionIva: number | null;
  domicilio: string | null;
  arcaValidadoHuella: string | null;
  arcaValidadoAt: Date | null;
};

/** Para comparar domicilios escritos distinto ("Av. San Martín 12" vs "AV SAN MARTIN 12"). */
function normalizarTexto(v: string | null | undefined): string {
  return (v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function esArgentina(pais: string | null): boolean {
  const p = (pais ?? '').trim().toUpperCase();
  return p === '' || p === 'AR' || p === 'ARGENTINA';
}

/**
 * Huella de los datos fiscales validados. Se guarda al validar; si después cambia el CUIT,
 * la condición IVA o el domicilio (por cualquier vía: edición, importación, superadmin),
 * deja de coincidir y la próxima validación vuelve a consultar ARCA.
 */
export function huellaFiscal(d: Pick<DatosFiscales, 'idFiscal' | 'condicionIva' | 'domicilio'>): string {
  return [normalizarCuit(d.idFiscal ?? ''), d.condicionIva ?? '', normalizarTexto(d.domicilio)].join('|');
}

/**
 * Valida un Cliente/Transportista guardado contra el padrón de ARCA y deja una marca
 * (`arcaValidadoHuella`/`arcaValidadoAt`) para no volver a consultar mientras sus datos
 * fiscales no cambien. Respeta el opt-in `Tenant.validacionCuitArcaHabilitada`.
 */
@Injectable()
export class PadronValidacionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly padron: PadronService,
  ) {}

  async validar(
    tenantId: string,
    entidad: PadronEntidad,
    id: string,
  ): Promise<PadronValidacionResultado> {
    await this.assertHabilitada(tenantId);
    const datos = await this.leer(tenantId, entidad, id);
    const cuit = normalizarCuit(datos.idFiscal ?? '');
    if (!esArgentina(datos.pais) || !cuitDigitoVerificadorValido(cuit)) {
      return { resultado: 'no_aplica' };
    }

    const huella = huellaFiscal(datos);
    if (datos.arcaValidadoHuella === huella && datos.arcaValidadoAt) {
      return { resultado: 'validado', validadoAt: datos.arcaValidadoAt, desdeMarca: true };
    }

    const padron = await this.padron.consultar(cuit, tenantId);
    if (padron.estado === 'inactivo' || padron.estado === 'no_encontrado') {
      return { resultado: 'rechazado', padron };
    }

    const diferencias: PadronDiferencia[] = [];
    if (padron.condicionIva != null && datos.condicionIva !== padron.condicionIva) {
      diferencias.push('condicionIva');
    }
    if (
      padron.domicilio &&
      normalizarTexto(datos.domicilio) !== normalizarTexto(padron.domicilio)
    ) {
      diferencias.push('domicilio');
    }
    if (diferencias.length > 0) {
      return { resultado: 'diferencias', padron, diferencias };
    }

    const validadoAt = await this.marcar(tenantId, entidad, id, huella);
    return { resultado: 'validado', validadoAt, desdeMarca: false };
  }

  /**
   * El usuario revisó los datos contra lo que informó ARCA y los guardó (aunque haya dejado
   * el domicilio escrito a su manera): se marca como validado con los datos actuales.
   * Exige que el CUIT siga activo en el padrón (sale de la caché, no gasta otra consulta).
   */
  async confirmar(
    tenantId: string,
    entidad: PadronEntidad,
    id: string,
  ): Promise<PadronValidacionResultado> {
    await this.assertHabilitada(tenantId);
    const datos = await this.leer(tenantId, entidad, id);
    const cuit = normalizarCuit(datos.idFiscal ?? '');
    if (!esArgentina(datos.pais) || !cuitDigitoVerificadorValido(cuit)) {
      return { resultado: 'no_aplica' };
    }
    const padron = await this.padron.consultar(cuit, tenantId);
    if (padron.estado === 'inactivo' || padron.estado === 'no_encontrado') {
      return { resultado: 'rechazado', padron };
    }
    const validadoAt = await this.marcar(tenantId, entidad, id, huellaFiscal(datos));
    return { resultado: 'validado', validadoAt, desdeMarca: false };
  }

  private async assertHabilitada(tenantId: string): Promise<void> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { clerkOrgId: tenantId },
      select: { validacionCuitArcaHabilitada: true },
    });
    if (tenant?.validacionCuitArcaHabilitada !== true) {
      throw new ForbiddenException(
        'La validación de CUIT con ARCA no está habilitada para esta empresa.',
      );
    }
  }

  private async leer(tenantId: string, entidad: PadronEntidad, id: string): Promise<DatosFiscales> {
    const select = {
      idFiscal: true,
      pais: true,
      condicionIva: true,
      arcaValidadoHuella: true,
      arcaValidadoAt: true,
    } as const;
    if (entidad === 'clientes') {
      const row = await this.prisma.cliente.findFirst({
        where: { id, tenantId },
        select: { ...select, direccion: true },
      });
      if (!row) throw new NotFoundException('Cliente no encontrado');
      const { direccion, ...rest } = row;
      return { ...rest, domicilio: direccion };
    }
    const row = await this.prisma.transportista.findFirst({
      where: { id, tenantId },
      select: { ...select, domicilio: true },
    });
    if (!row) throw new NotFoundException('Transportista no encontrado');
    return row;
  }

  private async marcar(
    tenantId: string,
    entidad: PadronEntidad,
    id: string,
    huella: string,
  ): Promise<Date> {
    const validadoAt = new Date();
    const data = { arcaValidadoHuella: huella, arcaValidadoAt: validadoAt };
    const { count } =
      entidad === 'clientes'
        ? await this.prisma.cliente.updateMany({ where: { id, tenantId }, data })
        : await this.prisma.transportista.updateMany({ where: { id, tenantId }, data });
    if (count === 0) throw new NotFoundException();
    return validadoAt;
  }
}

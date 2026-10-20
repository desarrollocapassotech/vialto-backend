import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { cuitDigitoVerificadorValido, normalizarCuit } from '../../shared/util/cuit';
import { PadronService } from './padron.service';
import { PadronConsulta } from './padron.types';

export type PadronEntidad = 'clientes' | 'transportistas';

/** Dato del registro que no coincidía con ARCA y se actualizó solo. El CUIT nunca se toca. */
export type PadronDiferencia = 'nombre' | 'condicionIva' | 'domicilio';

export type PadronValidacionResultado =
  /** Sin CUIT argentino válido: no hay nada que validar. */
  | { resultado: 'no_aplica' }
  /** Coincide con ARCA. `desdeMarca` = no se consultó: ya estaba validado con estos mismos datos. */
  | { resultado: 'validado'; validadoAt: Date; desdeMarca: boolean }
  /**
   * CUIT activo pero razón social / condición IVA / domicilio distintos (o vacíos): se
   * guardaron los de ARCA sin pedir confirmación y quedó la marca de validado.
   */
  | {
      resultado: 'actualizado';
      validadoAt: Date;
      padron: PadronConsulta;
      cambios: PadronDiferencia[];
    }
  /** CUIT inactivo o inexistente en el padrón. */
  | { resultado: 'rechazado'; padron: PadronConsulta };

type DatosFiscales = {
  nombre: string;
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
 * Valida un Cliente/Transportista guardado contra el padrón de ARCA, actualiza solo la
 * razón social / condición IVA / domicilio si difieren (nunca el CUIT) y deja una marca
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

    // Lo que difiere de ARCA se actualiza solo (sin confirmación del usuario). El CUIT no.
    const nuevos: Partial<Pick<DatosFiscales, 'nombre' | 'condicionIva' | 'domicilio'>> = {};
    if (padron.nombre && datos.nombre.trim() !== padron.nombre) {
      nuevos.nombre = padron.nombre;
    }
    if (padron.condicionIva != null && datos.condicionIva !== padron.condicionIva) {
      nuevos.condicionIva = padron.condicionIva;
    }
    if (
      padron.domicilio &&
      normalizarTexto(datos.domicilio) !== normalizarTexto(padron.domicilio)
    ) {
      nuevos.domicilio = padron.domicilio;
    }
    const cambios = Object.keys(nuevos) as PadronDiferencia[];
    const validadoAt = await this.marcar(
      tenantId,
      entidad,
      id,
      huellaFiscal({ ...datos, ...nuevos }),
      nuevos,
    );
    return cambios.length > 0
      ? { resultado: 'actualizado', validadoAt, padron, cambios }
      : { resultado: 'validado', validadoAt, desdeMarca: false };
  }

  /**
   * El usuario revisó y editó a mano los datos que se habían actualizado desde ARCA: se
   * marca como validado con lo que guardó, para que la próxima validación no lo vuelva a
   * pisar. Exige que el CUIT siga activo (sale de la caché, no gasta otra consulta).
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
      nombre: true,
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

  /** Deja la marca de validado y, si viene `nuevos`, guarda en el mismo update los datos de ARCA. */
  private async marcar(
    tenantId: string,
    entidad: PadronEntidad,
    id: string,
    huella: string,
    nuevos: Partial<Pick<DatosFiscales, 'nombre' | 'condicionIva' | 'domicilio'>> = {},
  ): Promise<Date> {
    const validadoAt = new Date();
    const { domicilio, ...resto } = nuevos;
    const marca = { ...resto, arcaValidadoHuella: huella, arcaValidadoAt: validadoAt };
    const { count } =
      entidad === 'clientes'
        ? await this.prisma.cliente.updateMany({
            where: { id, tenantId },
            data: { ...marca, ...(domicilio !== undefined && { direccion: domicilio }) },
          })
        : await this.prisma.transportista.updateMany({
            where: { id, tenantId },
            data: { ...marca, ...(domicilio !== undefined && { domicilio }) },
          });
    if (count === 0) throw new NotFoundException();
    return validadoAt;
  }
}

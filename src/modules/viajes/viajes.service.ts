import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import { PrismaService } from "../../shared/prisma/prisma.service";
import { CloudinaryService } from "../../shared/storage/cloudinary.service";
import { ViajesAutoEstadoService } from "./viajes-auto-estado.service";
import { TenantFieldConfigService } from "../../core/tenant-field-config/tenant-field-config.service";
import { CreateViajeDto } from "./dto/create-viaje.dto";
import { AddGastoDto } from "./dto/add-gasto.dto";
import { AddPagoTransportistaDto } from "./dto/add-pago-transportista.dto";
import { generateNumeroViaje } from "./generate-viaje-numero";
import {
  assertTransportistaEfectivoSubcontratacion,
  mergeViajeOperacionIds,
  resolveContratanteRealizaFlete,
  resolveTransportistaEfectivoIdPersist,
} from "./viaje-operacion-exclusiva";
import {
  assertVehiculosDelViaje,
  idsProductosDelViaje,
  normalizarDestinosDelViaje,
  reemplazarDestinosDelViaje,
  reemplazarProductosDelViaje,
  reemplazarVehiculosDelViaje,
  ultimoDestinoEtiqueta,
  viajeDestinosViajeInclude,
  VIAJE_INCLUDE_VEHICULOS_INCLUDE,
  type ViajeConVehiculosViaje,
} from "./viaje-vehiculos.helper";
import {
  assertClientesDelViaje,
  assertProductosClientesDelViaje,
  normalizarClientesDelViaje,
  reemplazarClientesDelViaje,
  viajeClientesViajeInclude,
  type ViajeClienteItem,
} from "./viaje-clientes.helper";
import { labelEnFrase, productoLabelsDeTenant } from "../../shared/util/producto-label.util";
import { UpdateViajeDto } from "./dto/update-viaje.dto";
import { ViajesPaginatedQueryDto } from "./dto/viajes-paginated-query.dto";
import {
  VIAJE_ETAPAS_SET,
  esEtapaFinal,
  normalizarEtapaViaje,
  FACTURACION_ESTADOS_DISPONIBLES,
  FACTURACION_ESTADOS_PENDIENTES,
  LIQUIDACION_ESTADOS_DISPONIBLES,
  LIQUIDACION_ESTADOS_PENDIENTES,
  type ViajeEtapa,
} from "./viaje-estados";
import { syncLiquidacionEstadoViaje } from "./viaje-estado-financiero";
import {
  actualizarEstadoCargoLiquidacionCc,
  calcularAcordadoTransportista,
  estadoDisponibilidadCcDesde,
} from "./viaje-cuenta-corriente";
import {
  buildViajeExportacionesResponse,
  enrichViajeConExportaciones,
} from "./viaje-exportaciones.util";
import {
  GananciaBrutaValidationError,
  buildGananciaBrutaResumen,
  enrichViajeConGananciaBruta,
  gananciaBrutaValorOrdenable,
  resolveGananciaBrutaPersist,
} from "./viaje-ganancia-bruta.util";
import {
  buildViajesPaginatedWhere,
  buildViajesPrismaOrderBy,
  compareViajesFechaAr,
  compareViajesOrdenNullable,
  resolveViajesSort,
  type ViajesSortDir,
} from "./viajes-paginated-query.util";

/** Documentos por viaje: máximo 3 y 10 MB entre todos. */
const MAX_ADJUNTOS_VIAJE = 3;
const MAX_BYTES_ADJUNTOS_VIAJE = 10 * 1024 * 1024;

type ViajeAdjunto = {
  id: string;
  url: string;
  /** Título que carga el usuario (obligatorio). */
  titulo: string;
  /** Nombre original del archivo. */
  nombre: string;
  bytes: number;
  mimeType: string;
  createdAt: string;
  createdBy: string;
  /**
   * Borrado lógico: el documento sale del viaje pero queda registrado para analizar el
   * espacio ocupado y limpiar Cloudinary. `archivoEliminado` = si el archivo ya se borró
   * de Cloudinary (false = quedó ahí, reintentar en una limpieza).
   */
  borradoAt?: string;
  borradoPor?: string;
  archivoEliminado?: boolean;
};

/** Documentos vigentes (sin los borrados): lo que cuenta para el tope de 3 / 10 MB. */
function adjuntosActivos(adjuntos: ViajeAdjunto[]): ViajeAdjunto[] {
  return adjuntos.filter((a) => !a.borradoAt);
}

/** Lee `Viaje.adjuntos` (Json) tolerando filas viejas o mal formadas. */
function adjuntosDeViaje(raw: unknown): ViajeAdjunto[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Array<Partial<ViajeAdjunto>>)
    .filter((a) => a && typeof a.id === "string" && typeof a.url === "string")
    .map(
      (a) =>
        ({
          ...a,
          titulo: a.titulo || a.nombre || "Documento",
          bytes: Number(a.bytes) || 0,
        }) as ViajeAdjunto,
    );
}

/** Transacciones con varios writes + Neon pueden superar el default de 5s de Prisma. */
const VIAJE_INTERACTIVE_TX = { timeout: 20_000, maxWait: 10_000 } as const;

/**
 * Añadimos las liquidaciones y facturas al include base para que el frontend
 * y las validaciones cuenten siempre con el monto real de los comprobantes.
 */
const VIAJE_INCLUDE_FULL = {
  ...VIAJE_INCLUDE_VEHICULOS_INCLUDE,
  clientesViaje: viajeClientesViajeInclude,
  factura: {
    select: {
      id: true,
      numero: true,
      importe: true,
      moneda: true,
      estado: true,
      arcaEstado: true,
      arcaError: true,
      cae: true,
      caeFechaVto: true,
      cbteNro: true,
      ptoVenta: true,
      fechaEmision: true,
      ivaPct: true,
      // Comprobante adjunto (facturas manuales): el detalle del viaje lo ofrece con un clip.
      comprobanteUrl: true,
      viajes: { select: { id: true, monto: true } },
    },
  },
  liquidacionesViaje: {
    include: {
      liquidacion: {
        include: {
          conceptosLineas: true,
          viajes: true,
        },
      },
    },
  },
};

/**
 * Calcula el monto prorrateado que le corresponde a un viaje a partir
 * de las facturas/liquidaciones emitidas.
 */
function calcularMontosReales<
  T extends {
    monto?: number | null;
    precioTransportistaExterno?: number | null;
    factura?: any;
    liquidacionesViaje?: any;
  },
>(viaje: T) {
  let montoFacturadoReal = null;
  let monedaMontoFacturadoReal = null;
  let costoLiquidadoReal = null;
  let monedaCostoLiquidadoReal = null;

  // Prorrateo de Factura al cliente (aplica si no está anulada ni con error ARCA)
  if (
    viaje.factura &&
    typeof viaje.factura.importe === "number" &&
    viaje.factura.estado !== "anulada" &&
    viaje.factura.arcaEstado !== "error"
  ) {
    const totalEstimado =
      viaje.factura.viajes?.reduce(
        (acc: number, v: any) =>
          acc + (typeof v.monto === "number" ? v.monto : 0),
        0,
      ) || 0;

    if (totalEstimado > 0 && typeof viaje.monto === "number") {
      montoFacturadoReal =
        viaje.factura.importe * (viaje.monto / totalEstimado);
    } else {
      const cant = viaje.factura.viajes?.length || 1;
      montoFacturadoReal = viaje.factura.importe / cant;
    }
    monedaMontoFacturadoReal = viaje.factura.moneda;
  }

  // Prorrateo de Liquidación CVLP
  const liqViaje = viaje.liquidacionesViaje?.find(
    (lv: any) =>
      lv.liquidacion?.estado !== "anulado" &&
      lv.liquidacion?.estado !== "error",
  );
  if (liqViaje?.liquidacion) {
    const liq = liqViaje.liquidacion;
    if (liq.bruto > 0 && typeof liqViaje.subtotal === "number") {
      costoLiquidadoReal = liq.liquido * (liqViaje.subtotal / liq.bruto);
    } else {
      costoLiquidadoReal = liq.liquido / (liq.cantViajes || 1);
    }
    monedaCostoLiquidadoReal = "ARS";
  }

  return {
    ...viaje,
    montoFacturadoReal,
    monedaMontoFacturadoReal,
    costoLiquidadoReal,
    monedaCostoLiquidadoReal,
  };
}

type ProductoItem = { productoId: string; cantidad?: number; pesoKg?: number };
type PagoTransportistaInput = { monto?: unknown; moneda?: unknown };
type DestinoItem = { etiqueta: string };

function resolveDestinosParaCreate(dto: CreateViajeDto): DestinoItem[] {
  const fromArray = normalizarDestinosDelViaje(dto.destinos);
  if (fromArray.length > 0) return fromArray;
  const legacy = dto.destino?.trim();
  if (legacy) return [{ etiqueta: legacy }];
  throw new BadRequestException("Ingresá al menos un destino.");
}

function resolveDestinosParaUpdate(
  dto: UpdateViajeDto,
): DestinoItem[] | undefined {
  if (dto.destinos !== undefined) {
    const norm = normalizarDestinosDelViaje(dto.destinos);
    if (norm.length === 0) {
      throw new BadRequestException("Ingresá al menos un destino.");
    }
    return norm;
  }
  if (dto.destino !== undefined) {
    const legacy = dto.destino?.trim();
    if (!legacy) {
      throw new BadRequestException("El destino no puede estar vacío.");
    }
    return [{ etiqueta: legacy }];
  }
  return undefined;
}

/** Clientes adicionales del viaje (multi-cliente, opcional) — sin fallback legacy porque `clienteId` ya cubre el caso de un solo cliente. */
function resolveClientesParaCreate(dto: CreateViajeDto): ViajeClienteItem[] {
  return normalizarClientesDelViaje(dto.clientes);
}

function resolveClientesParaUpdate(
  dto: UpdateViajeDto,
): ViajeClienteItem[] | undefined {
  if (dto.clientes === undefined) return undefined;
  return normalizarClientesDelViaje(dto.clientes);
}

function normalizarProductoItems(
  raw: ProductoItem[] | undefined | null,
): ProductoItem[] {
  if (!raw?.length) return [];
  const seen = new Set<string>();
  const out: ProductoItem[] = [];
  for (const item of raw) {
    const id = String(item.productoId ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ productoId: id, cantidad: item.cantidad, pesoKg: item.pesoKg });
  }
  return out;
}

async function assertProductosAsignables(
  prisma: PrismaService,
  tenantId: string,
  items: ProductoItem[],
  opts: { modo: "create" | "update"; currentProductoIds?: ReadonlySet<string> },
): Promise<void> {
  if (items.length === 0) return;
  const ids = items.map((i) => i.productoId);
  const rows = await prisma.producto.findMany({
    where: { tenantId, id: { in: ids } },
    select: { id: true, activo: true },
  });
  if (rows.length !== ids.length) {
    // Frases neutras: el label puede ser femenino ("Mercadería").
    const { plural } = await productoLabelsDeTenant(prisma, tenantId);
    throw new BadRequestException(
      `Hay ${labelEnFrase(plural)} que no existen o no pertenecen a esta empresa.`,
    );
  }
  const current = opts.currentProductoIds ?? new Set<string>();
  for (const row of rows) {
    if (!row.activo) {
      const conserva = opts.modo === "update" && current.has(row.id);
      if (opts.modo === "create" || !conserva) {
        const { plural } = await productoLabelsDeTenant(prisma, tenantId);
        throw new BadRequestException(
          `Hay ${labelEnFrase(plural)} con estado inactivo. Elegí otra opción o cambiá su estado desde ${plural}.`,
        );
      }
    }
  }
}

export function assertFechaDescargaValida(
  fechaCarga: Date,
  fechaDescarga: Date,
): void {
  const fc = new Date(fechaCarga.toISOString().slice(0, 10));
  const fd = new Date(fechaDescarga.toISOString().slice(0, 10));
  if (fd < fc) {
    throw new BadRequestException(
      "La fecha de descarga no puede ser anterior a la fecha de carga.",
    );
  }
}

@Injectable()
export class ViajesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly autoEstado: ViajesAutoEstadoService,
    private readonly tenantFieldConfig: TenantFieldConfigService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  /**
   * `precioTransportistaIvaIncluidoPct` es opt-in (default oculto, ver field-catalog.ts).
  * La configuración compartida de Viajes es la señal canónica: si un tenant lo tuvo habilitado, cargó
   * valores, y después lo deshabilita, esos valores NO se borran de la base — solo se
   * dejan de tener en cuenta en cualquier cálculo (acordado, ganancia bruta, saldo,
   * dashboard) hasta que se vuelva a habilitar.
   */
  private ivaTransportistaHabilitado(tenantId: string): Promise<boolean> {
    return this.tenantFieldConfig.isCampoVisible(
      tenantId,
      "viajes",
      "edicion_viaje",
      "precioTransportistaIvaIncluidoPct",
    );
  }

  /**
   * Aplica el mismo criterio de arriba a un viaje (o lista) ya resuelto desde la base,
   * antes de responder al frontend: si el tenant tiene el campo deshabilitado, se
   * devuelve 0 en vez del valor real guardado (que sigue intacto en la base) — así
   * cualquier consumidor (grillas, badges de saldo, resumen de ganancia bruta, o el
   * propio frontend recalculando en cliente) ve exactamente el mismo "no aplica" sin
   * tener que conocer la configuración del tenant.
   */
  private zerarIvaTransportistaSiDeshabilitado<
    T extends { precioTransportistaIvaIncluidoPct?: unknown },
  >(item: T, habilitado: boolean): T {
    if (habilitado || item.precioTransportistaIvaIncluidoPct == null) {
      return item;
    }
    return { ...item, precioTransportistaIvaIncluidoPct: 0 };
  }

  /**
   * Si el tenant tiene `Tenant.idSistemaHabilitado = false`, el "ID Sistema"
   * autogenerado (`numero`) deja de mostrarse en toda la interfaz — así que
   * "ID Propio 1" (`numeroIdentificacionPersonalizado`) pasa a ser el único
   * identificador visible del viaje y ya no puede quedar vacío. Se valida acá
   * (no con una constraint de Prisma, no puede ser condicional por tenant) y
   * se replica en `viajes.processor.ts` (import) y en el frontend
   * (`ViajeCreatePage.tsx`/`ViajeEditModal.tsx`) para dar feedback inline.
   */
  private async assertIdPropio1SiSistemaDeshabilitado(
    tenantId: string,
    valor: string | null | undefined,
  ): Promise<void> {
    if (valor?.trim()) return;
    const tenant = await this.prisma.tenant.findUnique({
      where: { clerkOrgId: tenantId },
      select: {
        idSistemaHabilitado: true,
        labelIdentificacionPersonalizadaViajes: true,
      },
    });
    if (tenant?.idSistemaHabilitado === false) {
      const label =
        tenant.labelIdentificacionPersonalizadaViajes?.trim() || "ID propio";
      throw new BadRequestException(
        `${label} es obligatorio: tu empresa tiene deshabilitado el ID Sistema, así que todo viaje necesita este identificador cargado.`,
      );
    }
  }

  /** Acepta legado del `estado` combinado y valida contra {@link VIAJE_ETAPAS}. */
  private parseEtapaViaje(etapa: string): ViajeEtapa {
    const n = normalizarEtapaViaje(etapa);
    if (!VIAJE_ETAPAS_SET.has(n)) {
      throw new BadRequestException("Etapa de viaje inválida");
    }
    return n as ViajeEtapa;
  }

  /**
   * Obtiene el monto real acordado sumando las liquidaciones emitidas,
   * prorrateando los conceptos según si son del viaje puntual o generales.
   * La lógica vive en `viaje-cuenta-corriente.ts` (la comparte el import de Excel).
   */
  private calcularAcordado(
    v: {
      id?: string;
      precioTransportistaExterno?: number | null;
      precioTransportistaIvaIncluidoPct?: number | null;
      liquidacionesViaje?: any[];
    },
    ivaTransportistaHabilitado: boolean,
  ): number {
    return calcularAcordadoTransportista(v, ivaTransportistaHabilitado);
  }

  private applyGananciaBrutaFields(
    viaje: {
      monto?: number | null;
      monedaMonto?: string | null;
      monedaPrecioTransportistaExterno?: string | null;
      otrosGastos?: unknown;
    },
    dto: {
      gananciaBrutaManual?: number | null;
      monedaGananciaBrutaManual?: string | null;
      monedaMonto?: string;
      monedaPrecioTransportistaExterno?: string;
      otrosGastos?: unknown;
    },
    existing?: {
      gananciaBrutaManual?: number | null;
      monedaGananciaBrutaManual?: string | null;
    },
  ): {
    gananciaBrutaManual: number | null;
    monedaGananciaBrutaManual: string | null;
  } {
    try {
      return resolveGananciaBrutaPersist(
        {
          monto: viaje.monto,
          monedaMonto: dto.monedaMonto ?? viaje.monedaMonto,
          monedaPrecioTransportistaExterno:
            dto.monedaPrecioTransportistaExterno ??
            viaje.monedaPrecioTransportistaExterno,
          otrosGastos:
            dto.otrosGastos !== undefined ? dto.otrosGastos : viaje.otrosGastos,
        },
        {
          gananciaBrutaManual: dto.gananciaBrutaManual,
          monedaGananciaBrutaManual: dto.monedaGananciaBrutaManual,
        },
        existing,
      );
    } catch (e) {
      if (e instanceof GananciaBrutaValidationError) {
        throw new BadRequestException(e.message);
      }
      throw e;
    }
  }

  private assertPagosTransportistaNoSuperanSaldo(
    params: {
      id?: string;
      transportistaId?: string | null;
      precioTransportistaExterno?: number | null;
      monedaPrecioTransportistaExterno?: string | null;
      precioTransportistaIvaIncluidoPct?: number | null;
      pagosTransportista?: unknown;
      liquidacionesViaje?: any[];
    },
    ivaTransportistaHabilitado: boolean,
  ): void {
    const pagos = Array.isArray(params.pagosTransportista)
      ? (params.pagosTransportista as PagoTransportistaInput[])
      : [];
    if (pagos.length === 0) return;

    if (!params.transportistaId) {
      throw new BadRequestException(
        "Este viaje no tiene transportista externo asignado.",
      );
    }

    const monedaAcordada =
      params.monedaPrecioTransportistaExterno === "USD" ? "USD" : "ARS";

    // Calculamos el saldo incluyendo el monto de liquidaciones, si existen
    const totalAcordado = this.calcularAcordado(
      params,
      ivaTransportistaHabilitado,
    );

    const totalPagado = pagos
      .filter((p) => (p.moneda === "USD" ? "USD" : "ARS") === monedaAcordada)
      .reduce((acc, p) => {
        const monto =
          typeof p.monto === "number" && Number.isFinite(p.monto) ? p.monto : 0;
        return acc + monto;
      }, 0);

    if (totalPagado > totalAcordado + 1e-6) {
      throw new BadRequestException(
        "El monto del pago no puede superar el saldo pendiente del viaje (calculado contra la liquidación o la tarifa estimada).",
      );
    }
  }

  /** Traduce un P2002 de `Viaje` (numero / numeroIdentificacionPersonalizado únicos por tenant) a un 409 legible; relanza cualquier otro error tal cual. */
  private assertNoUniqueConstraintViolation(e: unknown): never {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      const target = e.meta?.target;
      const targetStr = Array.isArray(target)
        ? target.join(",")
        : String(target ?? "");
      if (targetStr.includes("numeroIdentificacionPersonalizado")) {
        throw new ConflictException(
          "Ya existe otro viaje con ese ID personalizado en esta empresa. Usá un valor distinto.",
        );
      }
      if (targetStr.includes("numero")) {
        throw new ConflictException(
          "Ya existe un viaje con ese número en esta empresa.",
        );
      }
    }
    throw e;
  }

  private async tieneArca(tenantId: string): Promise<boolean> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { clerkOrgId: tenantId },
      select: { modules: true },
    });
    const modules = (tenant?.modules ?? []).map((m) => m.toLowerCase());
    return (
      modules.includes("emision-facturas-arca") ||
      modules.includes("emision-liquido-producto-arca")
    );
  }

  /**
   * Recalcula (sin recrear) el cargo de cuenta corriente del proveedor a partir de la
   * suma actual de `pagosTransportista` — usado por `addPagoTransportista` y
   * `deletePagoTransportista`. Si el cargo todavía no existe (viaje sin precio del
   * transportista, o anterior a que se generara) no hace nada: no hay nada que sincronizar.
   * Si el viaje ya está liquidado, su movimiento es el de la liquidación (puede abarcar
   * varios viajes): se recalcula sumando los pagos de todos ellos.
   */
  private async sincronizarCargoCcTransportista(
    tx: Prisma.TransactionClient,
    tenantId: string,
    viajeId: string,
    transportistaId: string,
    moneda: string,
    pagado: number,
  ) {
    const liquidacionVigente = await tx.liquidacionViaje.findFirst({
      where: {
        tenantId,
        viajeId,
        liquidacion: { transportistaId, estado: { not: "anulado" } },
      },
      select: { liquidacionId: true },
    });
    if (liquidacionVigente) {
      await actualizarEstadoCargoLiquidacionCc(tx, tenantId, liquidacionVigente.liquidacionId);
      return;
    }
    const cargo = await tx.movimientoCuentaCorriente.findFirst({
      where: {
        tenantId,
        viajeId,
        proveedorId: transportistaId,
        tipo: "cargo",
        origen: "viaje",
        moneda,
        estadoDisponibilidad: { not: "anulado" },
      },
    });
    if (!cargo) return;
    await tx.movimientoCuentaCorriente.update({
      where: { id: cargo.id },
      data: { estadoDisponibilidad: estadoDisponibilidadCcDesde(pagado, cargo.importe) },
    });
  }

  /**
   * Espejo de `FacturacionService.registrarPagoDesdeCuentaCorriente` pero del lado
   * proveedor: cuando se imputa un pago de Cuenta Corriente a un cargo de
   * transportista vinculado a un viaje (`viajeId`), agrega la entrada equivalente a
   * `Viaje.pagosTransportista` para que quede unificado con la carga operativa de
   * siempre (misma lista que ve/usa la pantalla de Viajes). Acepta `tx` opcional
   * para participar de la transacción de `CuentaCorrienteService.crearImputacion`.
   */
  async registrarPagoTransportistaDesdeCuentaCorriente(
    tenantId: string,
    viajeId: string,
    ccImputacionId: string,
    importe: number,
    moneda: string,
    fecha: Date,
    formaPago?: string | null,
    client: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    const viaje = await client.viaje.findFirst({ where: { id: viajeId, tenantId } });
    if (!viaje) return null;
    const pagosActuales = Array.isArray(viaje.pagosTransportista)
      ? (viaje.pagosTransportista as Array<Record<string, unknown>>)
      : [];
    const nuevoPago: Record<string, unknown> = {
      monto: importe,
      moneda,
      fecha:
        fecha instanceof Date
          ? fecha.toISOString().slice(0, 10)
          : String(fecha).slice(0, 10),
      createdBy: "cuenta-corriente",
      createdAt: new Date().toISOString(),
      ccImputacionId,
    };
    if (formaPago?.trim()) nuevoPago.observaciones = `Medio de pago: ${formaPago.trim()}`;
    const pagosActualizados = [...pagosActuales, nuevoPago];
    await client.viaje.update({
      where: { id: viajeId },
      data: { pagosTransportista: pagosActualizados as unknown as Prisma.InputJsonValue },
    });
    if (viaje.transportistaId) {
      await this.resincronizarCargoCcTransportistaDesdeJson(
        client,
        tenantId,
        viajeId,
        viaje.transportistaId,
        pagosActualizados,
      );
    }
    return nuevoPago;
  }

  /** Contraparte de `registrarPagoTransportistaDesdeCuentaCorriente`, al deshacer una imputación en Cuenta Corriente. */
  async eliminarPagoTransportistaDesdeCuentaCorriente(
    tenantId: string,
    viajeId: string,
    ccImputacionId: string,
    client: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    const viaje = await client.viaje.findFirst({ where: { id: viajeId, tenantId } });
    if (!viaje) return;
    const pagosActuales = Array.isArray(viaje.pagosTransportista)
      ? (viaje.pagosTransportista as Array<Record<string, unknown>>)
      : [];
    const pagosActualizados = pagosActuales.filter(
      (p) => p.ccImputacionId !== ccImputacionId,
    );
    if (pagosActualizados.length === pagosActuales.length) return;
    await client.viaje.update({
      where: { id: viajeId },
      data: { pagosTransportista: pagosActualizados as unknown as Prisma.InputJsonValue },
    });
    if (viaje.transportistaId) {
      await this.resincronizarCargoCcTransportistaDesdeJson(
        client,
        tenantId,
        viajeId,
        viaje.transportistaId,
        pagosActualizados,
      );
    }
  }

  /** Recalcula la moneda/suma desde `pagosTransportista` y delega en `sincronizarCargoCcTransportista`. */
  private async resincronizarCargoCcTransportistaDesdeJson(
    client: PrismaService | Prisma.TransactionClient,
    tenantId: string,
    viajeId: string,
    transportistaId: string,
    pagos: Array<Record<string, unknown>>,
    monedaAcordada?: string,
  ) {
    const viaje = monedaAcordada
      ? null
      : await client.viaje.findFirst({
          where: { id: viajeId, tenantId },
          select: { monedaPrecioTransportistaExterno: true },
        });
    const moneda =
      monedaAcordada ??
      (viaje?.monedaPrecioTransportistaExterno === "USD" ? "USD" : "ARS");
    const pagado = pagos
      .filter((p) => ((p as { moneda?: string }).moneda === "USD" ? "USD" : "ARS") === moneda)
      .reduce((acc, p) => acc + (Number((p as { monto?: number }).monto) || 0), 0);
    await this.sincronizarCargoCcTransportista(
      client as Prisma.TransactionClient,
      tenantId,
      viajeId,
      transportistaId,
      moneda,
      pagado,
    );
  }

  private async assertRefs(
    tenantId: string,
    dto: {
      clienteId: string;
      transportistaId?: string | null;
      choferId?: string | null;
      transportistaEfectivoId?: string | null;
    },
  ) {
    const [c, t, ch, te] = await Promise.all([
      this.prisma.cliente.findFirst({ where: { id: dto.clienteId, tenantId } }),
      dto.transportistaId
        ? this.prisma.transportista.findFirst({
            where: { id: dto.transportistaId, tenantId },
          })
        : null,
      dto.choferId
        ? this.prisma.chofer.findFirst({
            where: { id: dto.choferId, tenantId },
          })
        : null,
      dto.transportistaEfectivoId
        ? this.prisma.transportista.findFirst({
            where: { id: dto.transportistaEfectivoId, tenantId },
          })
        : null,
    ]);

    if (!c) throw new BadRequestException("Cliente inválido para este tenant");
    if (dto.transportistaId && !t)
      throw new BadRequestException("Transportista inválido");
    if (dto.choferId && !ch) throw new BadRequestException("Chofer inválido");
    if (dto.transportistaEfectivoId && !te)
      throw new BadRequestException("Transportista efectivo inválido");
    if (
      dto.transportistaEfectivoId &&
      dto.transportistaEfectivoId === dto.transportistaId
    )
      throw new BadRequestException(
        "El transportista efectivo no puede ser el mismo que el contratante",
      );
  }

  /**
   * Los 200 viajes más recientes + todos los que siguen pendientes de facturar o de
   * liquidar, sin importar su antigüedad. Lo usan los modales de factura/liquidación
   * (Viajes, Facturación, Liquidaciones, Inicio) para ofrecer viajes y clientes: con el
   * tope solo, un viaje viejo sin facturar quedaba afuera y su cliente no aparecía en
   * "Nueva factura" (bug real LSF, oct 2026: 232 viajes, el pendiente era el n° 225).
   */
  async findAll(tenantId: string, etapa?: string) {
    const ivaTransportistaHabilitado =
      await this.ivaTransportistaHabilitado(tenantId);
    const include = {
      cliente: { select: { id: true, nombre: true } },
      transportista: { select: { id: true, nombre: true } },
      transportistaEfectivo: { select: { id: true, nombre: true } },
      destinosViaje: viajeDestinosViajeInclude,
      ...VIAJE_INCLUDE_FULL,
    } as any;
    const where = { tenantId, ...(etapa ? { etapa } : {}) };
    const recientes = await this.prisma.viaje.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 200,
      include,
    });
    const pendientes = await this.prisma.viaje.findMany({
      where: {
        ...where,
        id: { notIn: recientes.map((r) => r.id) },
        OR: [
          { facturacionEstado: { in: [...FACTURACION_ESTADOS_PENDIENTES] } },
          {
            clientesViaje: {
              some: {
                tenantId,
                facturacionEstado: { in: [...FACTURACION_ESTADOS_PENDIENTES] },
              },
            },
          },
          { liquidacionEstado: { in: [...LIQUIDACION_ESTADOS_PENDIENTES] } },
        ],
      },
      orderBy: { createdAt: "desc" },
      include,
    });
    const rows = [...recientes, ...pendientes];
    return rows.map((r) =>
      calcularMontosReales(
        this.zerarIvaTransportistaSiDeshabilitado(r, ivaTransportistaHabilitado),
      ),
    );
  }

  async getStats(tenantId: string) {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const ivaTransportistaHabilitado =
      await this.ivaTransportistaHabilitado(tenantId);

    // null monedaMonto/monedaPrecioTransportistaExterno is treated as ARS (same convention
    // used throughout the codebase, e.g. getViajesSaldoPendienteTransportista).
    const baseWhere = { tenantId, createdAt: { gte: monthStart } };

    const [
      etapaRows,
      finalizadoSinFacturar,
      facturadoSinCobrar,
      cobrado,
      ingresosARS,
      ingresosUSD,
      gastosARS,
      gastosUSD,
      saldoViajes,
    ] = await Promise.all([
      this.prisma.viaje.groupBy({
        by: ["etapa"],
        where: { tenantId },
        _count: { _all: true },
      }),
      this.prisma.viaje.count({
        where: {
          tenantId,
          etapa: "finalizado",
          facturacionEstado: { in: [...FACTURACION_ESTADOS_PENDIENTES] },
        },
      }),
      this.prisma.viaje.count({
        where: { tenantId, facturacionEstado: "facturado" },
      }),
      this.prisma.viaje.count({
        where: { tenantId, facturacionEstado: "cobrado" },
      }),
      this.prisma.viaje.aggregate({
        where: {
          ...baseWhere,
          monto: { not: null },
          monedaMonto: { not: "USD" },
        },
        _sum: { monto: true },
      }),
      this.prisma.viaje.aggregate({
        where: { ...baseWhere, monto: { not: null }, monedaMonto: "USD" },
        _sum: { monto: true },
      }),
      this.prisma.viaje.aggregate({
        where: {
          ...baseWhere,
          precioTransportistaExterno: { not: null },
          monedaPrecioTransportistaExterno: { not: "USD" },
        },
        _sum: { precioTransportistaExterno: true },
      }),
      this.prisma.viaje.aggregate({
        where: {
          ...baseWhere,
          precioTransportistaExterno: { not: null },
          monedaPrecioTransportistaExterno: "USD",
        },
        _sum: { precioTransportistaExterno: true },
      }),
      this.prisma.viaje.findMany({
        where: {
          tenantId,
          transportistaId: { not: null },
          precioTransportistaExterno: { gt: 0 },
        },
        select: {
          id: true,
          precioTransportistaExterno: true,
          monedaPrecioTransportistaExterno: true,
          precioTransportistaIvaIncluidoPct: true,
          pagosTransportista: true,
          liquidacionesViaje: {
            include: {
              liquidacion: {
                include: {
                  conceptosLineas: true,
                  viajes: true,
                },
              },
            },
          },
        },
      }),
    ]);

    let pendienteARS = 0;
    let pendienteUSD = 0;
    for (const v of saldoViajes) {
      const moneda =
        v.monedaPrecioTransportistaExterno === "USD" ? "USD" : "ARS";
      const acordado = this.calcularAcordado(v, ivaTransportistaHabilitado);
      const pagos = Array.isArray(v.pagosTransportista)
        ? (v.pagosTransportista as Array<{ monto?: number; moneda?: string }>)
        : [];
      const pagado = pagos
        .filter(
          (p) => ((p.moneda ?? "ARS") === "USD" ? "USD" : "ARS") === moneda,
        )
        .reduce(
          (sum, p) => sum + (typeof p.monto === "number" ? p.monto : 0),
          0,
        );
      const saldo = acordado - pagado;
      if (saldo > 0) {
        if (moneda === "ARS") pendienteARS += saldo;
        else pendienteUSD += saldo;
      }
    }

    return {
      ...Object.fromEntries(etapaRows.map((r) => [r.etapa, r._count._all])),
      finalizado_sin_facturar: finalizadoSinFacturar,
      facturado_sin_cobrar: facturadoSinCobrar,
      cobrado,
      montos: {
        ingresos: {
          ARS: ingresosARS._sum.monto ?? 0,
          USD: ingresosUSD._sum.monto ?? 0,
        },
        gastos: {
          ARS: gastosARS._sum.precioTransportistaExterno ?? 0,
          USD: gastosUSD._sum.precioTransportistaExterno ?? 0,
        },
        pendiente: { ARS: pendienteARS, USD: pendienteUSD },
      },
    };
  }

  async findAllPaginated(tenantId: string, query: ViajesPaginatedQueryDto) {
    // Lazy update: sincroniza estados por fecha antes de devolver resultados
    await this.autoEstado.actualizarEstadosPorFecha(tenantId);

    const page = Math.max(1, Math.floor(Number(query.page) || 1));
    const pageSize = Math.min(
      100,
      Math.max(1, Math.floor(Number(query.pageSize) || 10)),
    );
    const where = buildViajesPaginatedWhere(tenantId, query);
    const { sortBy, sortDir } = resolveViajesSort(query);
    const ivaTransportistaHabilitado =
      await this.ivaTransportistaHabilitado(tenantId);

    if (sortBy === "ganancia_bruta") {
      return this.findAllPaginatedOrdenGananciaBruta(
        where,
        page,
        pageSize,
        sortDir,
        ivaTransportistaHabilitado,
      );
    }

    if (sortBy === "fecha_carga" || sortBy === "fecha_descarga") {
      return this.findAllPaginatedOrdenFecha(
        where,
        page,
        pageSize,
        sortBy,
        sortDir,
        ivaTransportistaHabilitado,
      );
    }

    if (sortBy === "monto") {
      return this.findAllPaginatedOrdenMonto(
        where,
        page,
        pageSize,
        sortDir,
        ivaTransportistaHabilitado,
      );
    }

    const orderBy = buildViajesPrismaOrderBy(sortBy, sortDir);
    const [total, items] = await this.prisma.$transaction([
      this.prisma.viaje.count({ where }),
      this.prisma.viaje.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: VIAJE_INCLUDE_FULL,
      }),
    ]);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    return {
      items: items.map((item) =>
        this.zerarIvaTransportistaSiDeshabilitado(
          enrichViajeConExportaciones(calcularMontosReales(item)),
          ivaTransportistaHabilitado,
        ),
      ),
      meta: {
        page,
        pageSize,
        total,
        totalPages,
        hasPrev: page > 1,
        hasNext: page < totalPages,
      },
    };
  }

  private async findAllPaginatedOrdenFecha(
    where: Prisma.ViajeWhereInput,
    page: number,
    pageSize: number,
    sortBy: "fecha_carga" | "fecha_descarga",
    sortDir: ViajesSortDir,
    ivaTransportistaHabilitado: boolean,
  ) {
    const prismaField =
      sortBy === "fecha_carga" ? "fechaCarga" : "fechaDescarga";
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.viaje.count({ where }),
      this.prisma.viaje.findMany({
        where,
        select: { id: true, fechaCarga: true, fechaDescarga: true },
      }),
    ]);

    const sortedIds = rows
      .map((row) => ({
        id: row.id,
        fecha: row[prismaField],
      }))
      .sort((a, b) =>
        compareViajesFechaAr(a.fecha, b.fecha, sortDir, () =>
          a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
        ),
      )
      .map((row) => row.id);

    return this.findAllPaginatedPageFromSortedIds(
      where,
      sortedIds,
      total,
      page,
      pageSize,
      ivaTransportistaHabilitado,
    );
  }

  private async findAllPaginatedOrdenMonto(
    where: Prisma.ViajeWhereInput,
    page: number,
    pageSize: number,
    sortDir: ViajesSortDir,
    ivaTransportistaHabilitado: boolean,
  ) {
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.viaje.count({ where }),
      this.prisma.viaje.findMany({
        where,
        select: {
          id: true,
          monto: true,
          monedaMonto: true,
          factura: VIAJE_INCLUDE_FULL.factura,
        },
      }),
    ]);

    const sortedIds = rows
      .map((row) => {
        const conReales = calcularMontosReales(row);
        const valorMonto = conReales.montoFacturadoReal ?? row.monto;
        return { id: row.id, valor: valorMonto };
      })
      .sort((a, b) =>
        compareViajesOrdenNullable(a.valor, b.valor, sortDir, () =>
          a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
        ),
      )
      .map((row) => row.id);

    return this.findAllPaginatedPageFromSortedIds(
      where,
      sortedIds,
      total,
      page,
      pageSize,
      ivaTransportistaHabilitado,
    );
  }

  private async findAllPaginatedOrdenGananciaBruta(
    where: Prisma.ViajeWhereInput,
    page: number,
    pageSize: number,
    sortDir: ViajesSortDir,
    ivaTransportistaHabilitado: boolean,
  ) {
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.viaje.count({ where }),
      this.prisma.viaje.findMany({
        where,
        select: {
          id: true,
          monto: true,
          monedaMonto: true,
          precioTransportistaExterno: true,
          precioTransportistaIvaIncluidoPct: true,
          monedaPrecioTransportistaExterno: true,
          otrosGastos: true,
          gananciaBrutaManual: true,
          monedaGananciaBrutaManual: true,
          factura: VIAJE_INCLUDE_FULL.factura,
          liquidacionesViaje: VIAJE_INCLUDE_FULL.liquidacionesViaje,
        },
      }),
    ]);

    const sortedIds = rows
      .map((row) => {
        const conReales = calcularMontosReales(row);
        const viaParaOrden = {
          ...row,
          monto: conReales.montoFacturadoReal ?? row.monto,
          monedaMonto: conReales.monedaMontoFacturadoReal ?? row.monedaMonto,
          precioTransportistaExterno:
            conReales.costoLiquidadoReal ?? row.precioTransportistaExterno,
          // Con costo real de una Liquidación ya reconciliado, el % de IVA del viaje
          // no aplica (ese monto ya es el líquido real, no el precio cargado). Tampoco
          // aplica si el tenant tiene el campo deshabilitado (ver ivaTransportistaHabilitado()).
          precioTransportistaIvaIncluidoPct:
            conReales.costoLiquidadoReal != null || !ivaTransportistaHabilitado
              ? 0
              : row.precioTransportistaIvaIncluidoPct,
          monedaPrecioTransportistaExterno:
            conReales.monedaCostoLiquidadoReal ??
            row.monedaPrecioTransportistaExterno,
        };
        return {
          id: row.id,
          valor: gananciaBrutaValorOrdenable(viaParaOrden as any),
        };
      })
      .sort((a, b) =>
        compareViajesOrdenNullable(a.valor, b.valor, sortDir, () =>
          a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
        ),
      )
      .map((row) => row.id);

    return this.findAllPaginatedPageFromSortedIds(
      where,
      sortedIds,
      total,
      page,
      pageSize,
      ivaTransportistaHabilitado,
    );
  }

  private async findAllPaginatedPageFromSortedIds(
    _where: Prisma.ViajeWhereInput,
    sortedIds: string[],
    total: number,
    page: number,
    pageSize: number,
    ivaTransportistaHabilitado: boolean,
  ) {
    const pageIds = sortedIds.slice((page - 1) * pageSize, page * pageSize);
    const itemsUnsorted =
      pageIds.length === 0
        ? []
        : await this.prisma.viaje.findMany({
            where: { id: { in: pageIds } },
            include: VIAJE_INCLUDE_FULL,
          });
    const byId = new Map(itemsUnsorted.map((item) => [item.id, item]));
    const items = pageIds
      .map((id) => byId.get(id))
      .filter((item): item is NonNullable<typeof item> => item != null);

    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    return {
      items: items.map((item) =>
        this.zerarIvaTransportistaSiDeshabilitado(
          enrichViajeConExportaciones(calcularMontosReales(item)),
          ivaTransportistaHabilitado,
        ),
      ),
      meta: {
        page,
        pageSize,
        total,
        totalPages,
        hasPrev: page > 1,
        hasNext: page < totalPages,
      },
    };
  }

  async findOne(id: string, tenantId: string): Promise<ViajeConVehiculosViaje> {
    const ivaTransportistaHabilitado =
      await this.ivaTransportistaHabilitado(tenantId);
    const row = await this.prisma.viaje.findFirst({
      where: { id, tenantId },
      include: VIAJE_INCLUDE_FULL,
    });
    if (!row) throw new NotFoundException("Viaje no encontrado");
    const rowSinIva = this.zerarIvaTransportistaSiDeshabilitado(
      row,
      ivaTransportistaHabilitado,
    );
    return enrichViajeConGananciaBruta(
      enrichViajeConExportaciones(
        calcularMontosReales(rowSinIva) as unknown as ViajeConVehiculosViaje,
      ),
    ) as ViajeConVehiculosViaje;
  }

  async getGananciaBruta(id: string, tenantId: string) {
    const ivaTransportistaHabilitado =
      await this.ivaTransportistaHabilitado(tenantId);
    const row = await this.prisma.viaje.findFirst({
      where: { id, tenantId },
      select: {
        monto: true,
        monedaMonto: true,
        precioTransportistaExterno: true,
        precioTransportistaIvaIncluidoPct: true,
        monedaPrecioTransportistaExterno: true,
        otrosGastos: true,
        gananciaBrutaManual: true,
        monedaGananciaBrutaManual: true,
        factura: VIAJE_INCLUDE_FULL.factura,
        liquidacionesViaje: VIAJE_INCLUDE_FULL.liquidacionesViaje,
      },
    });
    if (!row) throw new NotFoundException("Viaje no encontrado");

    const conReales = calcularMontosReales(row);
    const viaParaResumen = {
      ...row,
      monto: conReales.montoFacturadoReal ?? row.monto,
      monedaMonto: conReales.monedaMontoFacturadoReal ?? row.monedaMonto,
      precioTransportistaExterno:
        conReales.costoLiquidadoReal ?? row.precioTransportistaExterno,
      // Con costo real de una Liquidación ya reconciliado, el % de IVA del viaje no
      // aplica (ese monto ya es el líquido real, no el precio cargado). Tampoco aplica
      // si el tenant tiene el campo deshabilitado (opt-in, ver ivaTransportistaHabilitado()).
      precioTransportistaIvaIncluidoPct:
        conReales.costoLiquidadoReal != null || !ivaTransportistaHabilitado
          ? 0
          : row.precioTransportistaIvaIncluidoPct,
      monedaPrecioTransportistaExterno:
        conReales.monedaCostoLiquidadoReal ??
        row.monedaPrecioTransportistaExterno,
    };
    return buildGananciaBrutaResumen(viaParaResumen as any);
  }

  async getExportaciones(id: string, tenantId: string) {
    const row = await this.prisma.viaje.findFirst({
      where: { id, tenantId },
      select: { id: true, numero: true, transportistaId: true },
    });
    if (!row) throw new NotFoundException("Viaje no encontrado");
    return buildViajeExportacionesResponse(row);
  }

  async create(tenantId: string, userId: string, dto: CreateViajeDto) {
    await this.assertIdPropio1SiSistemaDeshabilitado(
      tenantId,
      dto.numeroIdentificacionPersonalizado,
    );
    const ivaTransportistaHabilitado =
      await this.ivaTransportistaHabilitado(tenantId);
    const op = mergeViajeOperacionIds(
      { transportistaId: null, choferId: null, vehiculoIds: [] },
      {
        transportistaId: dto.transportistaId,
        choferId: dto.choferId,
        vehiculoIds: dto.vehiculoIds,
      },
    );
    const transportistaExterno = op.transportistaId?.trim();
    const vehiculoIds = op.vehiculoIds;
    const contratanteRealizaFlete =
      dto.contratanteRealizaFlete === true ||
      dto.contratanteRealizaFlete === false
        ? dto.contratanteRealizaFlete
        : resolveContratanteRealizaFlete({
            flag: dto.contratanteRealizaFlete,
            transportistaEfectivoIdInDto: dto.transportistaEfectivoId,
            hasTransportistaExterno: !!transportistaExterno,
          });
    const transportistaEfectivoId =
      dto.contratanteRealizaFlete === false
        ? (dto.transportistaEfectivoId ?? "").trim() || null
        : dto.contratanteRealizaFlete === true
          ? null
          : resolveTransportistaEfectivoIdPersist({
              hasTransportistaExterno: !!transportistaExterno,
              contratanteRealizaFlete,
              transportistaEfectivoIdInDto: dto.transportistaEfectivoId,
            });
    assertTransportistaEfectivoSubcontratacion({
      transportistaId: transportistaExterno,
      transportistaEfectivoId,
      contratanteRealizaFlete,
    });
    const refs = {
      clienteId: dto.clienteId,
      transportistaId: op.transportistaId,
      choferId: op.choferId,
      transportistaEfectivoId,
    };
    await this.assertRefs(tenantId, refs);
    if (!transportistaExterno) {
      await assertVehiculosDelViaje(this.prisma, tenantId, vehiculoIds, {
        requiereFlotaPropia: true,
      });
    } else if (vehiculoIds.length > 0) {
      await assertVehiculosDelViaje(this.prisma, tenantId, vehiculoIds, {
        requiereFlotaPropia: false,
      });
    }
    const productoItemsNorm = normalizarProductoItems(dto.productoItems);
    await assertProductosAsignables(this.prisma, tenantId, productoItemsNorm, {
      modo: "create",
    });
    const clientesNorm = resolveClientesParaCreate(dto);
    if (clientesNorm.length > 0) {
      await assertClientesDelViaje(
        this.prisma,
        tenantId,
        clientesNorm.map((c) => c.clienteId),
      );
      await assertProductosClientesDelViaje(this.prisma, tenantId, clientesNorm);
    }
    if (dto.fechaDescarga) {
      assertFechaDescargaValida(
        new Date(dto.fechaCarga),
        new Date(dto.fechaDescarga),
      );
    }
    const etapa = this.parseEtapaViaje(dto.etapa);
    if (esEtapaFinal(etapa)) {
      throw new BadRequestException(
        "Un viaje no puede crearse en etapa finalizado",
      );
    }
    let monto = dto.monto;
    if (dto.cantidadFactura != null && dto.precioUnitarioFactura != null) {
      monto = Math.round(dto.cantidadFactura * dto.precioUnitarioFactura * 100) / 100;
    }
    // `monto` sigue siendo el propio del cliente principal, tal cual lo carga el
    // usuario — nunca se reemplaza por la suma de los clientes adicionales (eso
    // perdería el monto principal). El total informativo del viaje se calcula
    // en lectura (monto del principal + suma de `clientesViaje`), nunca se persiste acá.

    let precioTransportistaExterno = dto.precioTransportistaExterno;
    if (
      dto.cantidadTransportista != null &&
      dto.precioUnitarioTransportista != null
    ) {
      precioTransportistaExterno =
        dto.cantidadTransportista * dto.precioUnitarioTransportista;
    }

    const numero =
      dto.numero?.trim() || (await generateNumeroViaje(this.prisma, tenantId));
    const gananciaPersist = this.applyGananciaBrutaFields(
      {
        monto,
        monedaMonto: dto.monedaMonto,
        monedaPrecioTransportistaExterno: dto.monedaPrecioTransportistaExterno,
        otrosGastos: dto.otrosGastos,
      },
      dto,
    );
    this.assertPagosTransportistaNoSuperanSaldo(
      {
        id: undefined,
        transportistaId: refs.transportistaId,
        precioTransportistaExterno,
        monedaPrecioTransportistaExterno: dto.monedaPrecioTransportistaExterno,
        precioTransportistaIvaIncluidoPct: dto.precioTransportistaIvaIncluidoPct,
        pagosTransportista: dto.pagosTransportista,
        liquidacionesViaje: [], // Al crearse, obviamente no tiene liquidaciones.
      },
      ivaTransportistaHabilitado,
    );
    const destinosNorm = resolveDestinosParaCreate(dto);
    const destinoFinal = ultimoDestinoEtiqueta(destinosNorm);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const data: Prisma.ViajeUncheckedCreateInput = {
          tenantId,
          numero,
          numeroIdentificacionPersonalizado:
            dto.numeroIdentificacionPersonalizado?.trim() || null,
          idPropio2: dto.idPropio2?.trim() || null,
          etapa,
          clienteId: dto.clienteId,
          transportistaId: refs.transportistaId,
          transportistaEfectivoId: refs.transportistaEfectivoId,
          choferId: refs.choferId,
          origen: dto.origen ?? null,
          destino: destinoFinal,
          fechaCarga: new Date(dto.fechaCarga),
          fechaDescarga: dto.fechaDescarga ? new Date(dto.fechaDescarga) : null,
          detalleCarga: dto.detalleCarga ?? null,
          kmRecorridos: dto.kmRecorridos ?? null,
          litrosConsumidos: dto.litrosConsumidos ?? null,
          monto,
          monedaMonto: dto.monedaMonto === "USD" ? "USD" : "ARS",
          precioTransportistaExterno: precioTransportistaExterno ?? null,
          monedaPrecioTransportistaExterno:
            dto.monedaPrecioTransportistaExterno === "USD" ? "USD" : "ARS",
          precioTransportistaIvaIncluidoPct:
            dto.precioTransportistaIvaIncluidoPct ?? 0,
          cantidadFactura: dto.cantidadFactura ?? null,
          precioUnitarioFactura: dto.precioUnitarioFactura ?? null,
          cantidadTransportista: dto.cantidadTransportista ?? null,
          precioUnitarioTransportista: dto.precioUnitarioTransportista ?? null,
          gananciaBrutaManual: gananciaPersist.gananciaBrutaManual,
          monedaGananciaBrutaManual: gananciaPersist.monedaGananciaBrutaManual,
          observaciones: dto.observaciones ?? null,
          otrosGastos: dto.otrosGastos
            ? (dto.otrosGastos as unknown as Prisma.InputJsonValue)
            : [],
          pagosTransportista: dto.pagosTransportista
            ? (dto.pagosTransportista as unknown as Prisma.InputJsonValue)
            : [],
          createdBy: userId,
        };
        const viaje = await tx.viaje.create({ data });
        // Inicializa liquidacionEstado (sin_liquidar | null) según transportista + ARCA del
        // tenant — la columna no tiene default propio porque su valor depende de eso, y sin
        // esta llamada un viaje recién creado queda en null hasta el primer evento de
        // liquidación, lo que bloquea a los selectores que exigen "sin_liquidar" explícito.
        await syncLiquidacionEstadoViaje(tx, tenantId, viaje.id);
        await reemplazarVehiculosDelViaje(tx, viaje.id, vehiculoIds, tenantId);
        await reemplazarProductosDelViaje(
          tx,
          viaje.id,
          productoItemsNorm,
          tenantId,
        );
        await reemplazarDestinosDelViaje(tx, viaje.id, destinosNorm, tenantId);
        await reemplazarClientesDelViaje(tx, viaje.id, clientesNorm, tenantId);
        const out = await tx.viaje.findFirstOrThrow({
          where: { id: viaje.id, tenantId },
          include: VIAJE_INCLUDE_FULL,
        });
        const outSinIva = this.zerarIvaTransportistaSiDeshabilitado(
          out,
          ivaTransportistaHabilitado,
        );
        return enrichViajeConGananciaBruta(
          calcularMontosReales(outSinIva) as unknown as ViajeConVehiculosViaje,
        ) as ViajeConVehiculosViaje;
      }, VIAJE_INTERACTIVE_TX);
    } catch (e) {
      this.assertNoUniqueConstraintViolation(e);
    }
  }

  /**
   * Campos que afectan comprobantes ya emitidos (montos, tarifas, cliente,
   * transportista). Se bloquean solo mientras el viaje tiene una factura o
   * liquidación vigente; los campos operativos (fechas, km, litros,
   * observaciones, etc.) siempre se pueden editar.
   */
  private static readonly CAMPOS_FISCALES_VIAJE = [
    "clienteId",
    "transportistaId",
    "transportistaEfectivoId",
    "contratanteRealizaFlete",
    "monto",
    "monedaMonto",
    "cantidadFactura",
    "precioUnitarioFactura",
    "precioTransportistaExterno",
    "monedaPrecioTransportistaExterno",
    "cantidadTransportista",
    "precioUnitarioTransportista",
    "gananciaBrutaManual",
    "monedaGananciaBrutaManual",
    "otrosGastos",
    "pagosTransportista",
  ] as const;

  async update(id: string, tenantId: string, dto: UpdateViajeDto) {
    const current = await this.findOne(id, tenantId);
    // Solo se valida si el campo viene explícito en el request (no bloquea
    // ediciones de otros campos en viajes viejos que quedaron sin ID Propio 1
    // antes de que el tenant deshabilitara el ID Sistema).
    if (dto.numeroIdentificacionPersonalizado !== undefined) {
      await this.assertIdPropio1SiSistemaDeshabilitado(
        tenantId,
        dto.numeroIdentificacionPersonalizado,
      );
    }
    const ivaTransportistaHabilitado =
      await this.ivaTransportistaHabilitado(tenantId);

    const facturacionEstado = (current as any).facturacionEstado as string;
    const liquidacionEstado = (current as any).liquidacionEstado as
      | string
      | null;
    const bloqueadoPorFactura = !(
      FACTURACION_ESTADOS_DISPONIBLES as readonly string[]
    ).includes(facturacionEstado);
    const bloqueadoPorLiquidacion =
      liquidacionEstado != null &&
      !(LIQUIDACION_ESTADOS_DISPONIBLES as readonly string[]).includes(
        liquidacionEstado,
      );

    if (bloqueadoPorFactura || bloqueadoPorLiquidacion) {
      const tieneArca = await this.tieneArca(tenantId);

      let camposBloqueados: readonly string[];
      if (tieneArca) {
        camposBloqueados = ViajesService.CAMPOS_FISCALES_VIAJE;
      } else {
        const camposCliente = [
          "clienteId",
          "monto",
          "monedaMonto",
          "cantidadFactura",
          "precioUnitarioFactura",
        ];
        const camposTransporte = [
          "transportistaId",
          "transportistaEfectivoId",
          "contratanteRealizaFlete",
          "precioTransportistaExterno",
          "monedaPrecioTransportistaExterno",
          "cantidadTransportista",
          "precioUnitarioTransportista",
          "gananciaBrutaManual",
          "monedaGananciaBrutaManual",
          "otrosGastos",
          "pagosTransportista",
        ];

        const bloqueados: string[] = [];
        if (bloqueadoPorFactura) bloqueados.push(...camposCliente);
        if (bloqueadoPorLiquidacion) bloqueados.push(...camposTransporte);
        camposBloqueados = bloqueados;
      }

      const camposTocados = camposBloqueados.filter(
        (campo) => (dto as Record<string, unknown>)[campo] !== undefined,
      );
      if (camposTocados.length > 0) {
        const motivo =
          bloqueadoPorFactura && bloqueadoPorLiquidacion
            ? "facturado y liquidado"
            : bloqueadoPorFactura
              ? "facturado"
              : "liquidado";
              
        const detalle = tieneArca
          ? "los datos comerciales"
          : (bloqueadoPorFactura && bloqueadoPorLiquidacion)
            ? "los datos comerciales"
            : bloqueadoPorFactura
              ? "los datos del cliente"
              : "los montos de transporte";

        throw new ConflictException(
          `No se puede editar ${detalle} porque el viaje ya fue ${motivo}. ` +
            "Los datos operativos (fechas, km, litros, observaciones) sí se pueden seguir editando.",
        );
      }
    }

    // `precioTransportistaIvaIncluidoPct` se bloquea solo por liquidación vigente (no
    // por facturación al cliente, que es un eje independiente): un viaje ya facturado al
    // cliente pero todavía sin liquidar al transportista tiene que poder ajustar este
    // campo antes de su primera liquidación — de lo contrario, un viaje viejo (de un
    // tenant que recién adopta integracion-arca) quedaría con el % atascado para
    // siempre en cuanto se facture, sin ninguna forma de corregirlo. Una vez liquidado,
    // el % queda fijo porque `Liquidacion.bruto` ya se calculó neteando con ese valor.
    // Si el tenant tiene el campo deshabilitado (opt-in, ver ivaTransportistaHabilitado()),
    // ni siquiera se llega a mirar esto — el valor entrante se ignora en silencio más
    // abajo (precioTransportistaIvaIncluidoPctResolved), nunca con un error.
    if (
      ivaTransportistaHabilitado &&
      bloqueadoPorLiquidacion &&
      dto.precioTransportistaIvaIncluidoPct !== undefined
    ) {
      throw new ConflictException(
        'No se puede cambiar el % de IVA incluido porque el viaje ya está liquidado o tiene una liquidación en curso.',
      );
    }

    const currentIds = current.vehiculosViaje.map((x) => x.vehiculoId);
    const op = mergeViajeOperacionIds(
      {
        transportistaId: current.transportistaId,
        choferId: current.choferId,
        vehiculoIds: currentIds,
      },
      dto,
    );
    const currentTeId = (current as { transportistaEfectivoId?: string | null })
      .transportistaEfectivoId;
    const contratanteRealizaFlete =
      dto.contratanteRealizaFlete === true ||
      dto.contratanteRealizaFlete === false
        ? dto.contratanteRealizaFlete
        : resolveContratanteRealizaFlete({
            flag: dto.contratanteRealizaFlete,
            transportistaEfectivoIdInDto: dto.transportistaEfectivoId,
            currentTransportistaEfectivoId: currentTeId,
            hasTransportistaExterno: !!op.transportistaId,
          });
    const transportistaEfectivoIdUpdate = !op.transportistaId
      ? null
      : dto.contratanteRealizaFlete === false
        ? (dto.transportistaEfectivoId ?? "").trim() || null
        : dto.contratanteRealizaFlete === true
          ? null
          : resolveTransportistaEfectivoIdPersist({
              hasTransportistaExterno: true,
              contratanteRealizaFlete,
              transportistaEfectivoIdInDto: dto.transportistaEfectivoId,
              currentTransportistaEfectivoId: currentTeId,
            });
    assertTransportistaEfectivoSubcontratacion({
      transportistaId: op.transportistaId,
      transportistaEfectivoId: transportistaEfectivoIdUpdate,
      contratanteRealizaFlete,
    });
    const merged = {
      clienteId: dto.clienteId ?? current.clienteId,
      transportistaId: op.transportistaId,
      choferId: op.choferId,
      transportistaEfectivoId: transportistaEfectivoIdUpdate,
    };
    await this.assertRefs(tenantId, merged);
    if (dto.fechaCarga !== undefined && !dto.fechaCarga)
      throw new BadRequestException("La fecha de carga es requerida");
    const fcResolved = dto.fechaCarga
      ? new Date(dto.fechaCarga)
      : current.fechaCarga;
    const fdResolved =
      dto.fechaDescarga === undefined
        ? current.fechaDescarga
        : dto.fechaDescarga
          ? new Date(dto.fechaDescarga)
          : null;
    if (fcResolved && fdResolved)
      assertFechaDescargaValida(fcResolved, fdResolved);
    if (!op.transportistaId) {
      await assertVehiculosDelViaje(this.prisma, tenantId, op.vehiculoIds, {
        requiereFlotaPropia: true,
      });
    }

    if (dto.productoItems !== undefined) {
      const nextProductos = normalizarProductoItems(dto.productoItems);
      await assertProductosAsignables(this.prisma, tenantId, nextProductos, {
        modo: "update",
        currentProductoIds: new Set(idsProductosDelViaje(current)),
      });
    }

    let precioTransportistaExternoInput = dto.precioTransportistaExterno;
    if (
      dto.cantidadTransportista != null &&
      dto.precioUnitarioTransportista != null
    ) {
      precioTransportistaExternoInput =
        dto.cantidadTransportista * dto.precioUnitarioTransportista;
    }

    let montoInput = dto.monto;
    if (dto.cantidadFactura != null && dto.precioUnitarioFactura != null) {
      montoInput =
        Math.round(dto.cantidadFactura * dto.precioUnitarioFactura * 100) / 100;
    }

    const precioTransportistaExternoResolved =
      precioTransportistaExternoInput !== undefined
        ? precioTransportistaExternoInput
        : current.precioTransportistaExterno;
    const monedaPrecioTransportistaExternoResolved =
      dto.monedaPrecioTransportistaExterno ??
      current.monedaPrecioTransportistaExterno;
    // Si el campo está deshabilitado para el tenant, se ignora cualquier valor que
    // venga en el dto (el formulario lo tiene oculto igual) y se preserva el valor
    // guardado tal cual, sin borrarlo — solo deja de tenerse en cuenta en los cálculos.
    const precioTransportistaIvaIncluidoPctResolved = !ivaTransportistaHabilitado
      ? (current as any).precioTransportistaIvaIncluidoPct
      : dto.precioTransportistaIvaIncluidoPct !== undefined
        ? dto.precioTransportistaIvaIncluidoPct
        : (current as any).precioTransportistaIvaIncluidoPct;
    const pagosTransportistaResolved =
      dto.pagosTransportista !== undefined
        ? dto.pagosTransportista
        : current.pagosTransportista;
    const etapaActual = this.parseEtapaViaje(
      current.etapa != null && String(current.etapa).trim() !== ""
        ? String(current.etapa)
        : "pendiente",
    );
    const etapaSiguiente =
      dto.etapa != null && String(dto.etapa).trim() !== ""
        ? this.parseEtapaViaje(String(dto.etapa))
        : etapaActual;

    // VTO-431: un viaje facturado o liquidado no se cancela directo — primero se anula
    // (o elimina) la factura/liquidación, y cada paso deja su propia compensación en
    // Cuenta Corriente, sin duplicar.
    if (etapaSiguiente === "cancelado" && etapaActual !== "cancelado") {
      const facturacionEstado = String((current as any).facturacionEstado ?? "sin_facturar");
      const liquidacionEstado = (current as any).liquidacionEstado as string | null;
      if (!["sin_facturar", "anulado"].includes(facturacionEstado)) {
        throw new BadRequestException(
          "El viaje tiene una factura vigente: anulala (o eliminala) antes de cancelar el viaje.",
        );
      }
      if (liquidacionEstado && !["sin_liquidar", "anulado"].includes(liquidacionEstado)) {
        throw new BadRequestException(
          "El viaje tiene una liquidación vigente: anulala (o eliminala) antes de cancelar el viaje.",
        );
      }
    }

    const data: Prisma.ViajeUpdateInput = {
      ...dto,
      monto:
        montoInput !== undefined ? montoInput : (current.monto ?? undefined),
      fechaCarga:
        dto.fechaCarga === undefined
          ? undefined
          : dto.fechaCarga
            ? new Date(dto.fechaCarga)
            : null,
      fechaDescarga:
        dto.fechaDescarga === undefined
          ? undefined
          : dto.fechaDescarga
            ? new Date(dto.fechaDescarga)
            : null,
    } as any;
    delete (data as { vehiculoIds?: unknown }).vehiculoIds;
    delete (data as { productoItems?: unknown }).productoItems;
    delete (data as { destinos?: unknown }).destinos;
    delete (data as { clientes?: unknown }).clientes;
    delete (data as { contratanteRealizaFlete?: unknown })
      .contratanteRealizaFlete;
    delete (data as { transportistaEfectivoId?: unknown })
      .transportistaEfectivoId;
    if (dto.numeroIdentificacionPersonalizado !== undefined) {
      (data as any).numeroIdentificacionPersonalizado =
        dto.numeroIdentificacionPersonalizado?.trim() || null;
    }
    if (dto.idPropio2 !== undefined) {
      (data as any).idPropio2 = dto.idPropio2?.trim() || null;
    }
    if (dto.otrosGastos !== undefined) {
      (data as any).otrosGastos =
        dto.otrosGastos as unknown as Prisma.InputJsonValue;
    }
    if (dto.pagosTransportista !== undefined) {
      (data as any).pagosTransportista =
        dto.pagosTransportista as unknown as Prisma.InputJsonValue;
    }

    if (precioTransportistaExternoInput !== undefined) {
      (data as any).precioTransportistaExterno =
        precioTransportistaExternoInput;
    }
    if (dto.monedaMonto !== undefined) {
      (data as any).monedaMonto = dto.monedaMonto === "USD" ? "USD" : "ARS";
    }
    if (dto.monedaPrecioTransportistaExterno !== undefined) {
      (data as any).monedaPrecioTransportistaExterno =
        dto.monedaPrecioTransportistaExterno === "USD" ? "USD" : "ARS";
    }
    if (!esEtapaFinal(etapaActual) && esEtapaFinal(etapaSiguiente)) {
      data.fechaFinalizado = new Date();
    }

    (data as any).etapa = etapaSiguiente;
    (data as any).transportistaId = op.transportistaId;
    (data as any).transportistaEfectivoId = merged.transportistaEfectivoId;
    (data as any).choferId = op.choferId;

    const gananciaPersist = this.applyGananciaBrutaFields(
      {
        monto: (data as { monto?: number }).monto ?? current.monto,
        monedaMonto:
          (data as { monedaMonto?: string }).monedaMonto ?? current.monedaMonto,
        monedaPrecioTransportistaExterno:
          (data as { monedaPrecioTransportistaExterno?: string })
            .monedaPrecioTransportistaExterno ??
          current.monedaPrecioTransportistaExterno,
        otrosGastos:
          dto.otrosGastos !== undefined ? dto.otrosGastos : current.otrosGastos,
      },
      {
        gananciaBrutaManual: dto.gananciaBrutaManual,
        monedaGananciaBrutaManual: dto.monedaGananciaBrutaManual,
        monedaMonto: dto.monedaMonto,
        monedaPrecioTransportistaExterno: dto.monedaPrecioTransportistaExterno,
        otrosGastos: dto.otrosGastos,
      },
      {
        gananciaBrutaManual: current.gananciaBrutaManual,
        monedaGananciaBrutaManual: current.monedaGananciaBrutaManual,
      },
    );
    delete (data as { gananciaBrutaManual?: unknown }).gananciaBrutaManual;
    delete (data as { monedaGananciaBrutaManual?: unknown })
      .monedaGananciaBrutaManual;
    (data as any).gananciaBrutaManual = gananciaPersist.gananciaBrutaManual;

    (data as any).monedaGananciaBrutaManual =
      gananciaPersist.monedaGananciaBrutaManual;
    if (!op.transportistaId) {
      (data as any).pagosTransportista = [];
    } else if (
      dto.pagosTransportista !== undefined ||
      precioTransportistaExternoInput !== undefined ||
      dto.monedaPrecioTransportistaExterno !== undefined
    ) {
      this.assertPagosTransportistaNoSuperanSaldo(
        {
          id,
          transportistaId: op.transportistaId,
          precioTransportistaExterno: precioTransportistaExternoResolved,
          monedaPrecioTransportistaExterno:
            monedaPrecioTransportistaExternoResolved,
          precioTransportistaIvaIncluidoPct:
            precioTransportistaIvaIncluidoPctResolved,
          pagosTransportista: pagosTransportistaResolved,
          liquidacionesViaje: (current as any).liquidacionesViaje,
        },
        ivaTransportistaHabilitado,
      );
    }

    const destinosUpdate = resolveDestinosParaUpdate(dto);
    if (destinosUpdate !== undefined) {
      (data as any).destino = ultimoDestinoEtiqueta(destinosUpdate);
    }

    const clientesUpdate = resolveClientesParaUpdate(dto);
    if (clientesUpdate !== undefined && clientesUpdate.length > 0) {
      await assertClientesDelViaje(
        this.prisma,
        tenantId,
        clientesUpdate.map((c) => c.clienteId),
      );
      await assertProductosClientesDelViaje(this.prisma, tenantId, clientesUpdate);
      // `monto` (arriba, ya resuelto en `data`) sigue siendo el propio del cliente
      // principal — no se reemplaza por la suma de los adicionales, ver mismo
      // criterio en `create()`.
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const updated = await tx.viaje.update({
          where: { id },
          data: data as Prisma.ViajeUncheckedUpdateInput,
        });
        await reemplazarVehiculosDelViaje(tx, id, op.vehiculoIds, tenantId);
        if (dto.productoItems !== undefined) {
          await reemplazarProductosDelViaje(
            tx,
            id,
            normalizarProductoItems(dto.productoItems),
            tenantId,
          );
        }
        if (destinosUpdate !== undefined) {
          await reemplazarDestinosDelViaje(tx, id, destinosUpdate, tenantId);
        }
        if (clientesUpdate !== undefined) {
          await reemplazarClientesDelViaje(tx, id, clientesUpdate, tenantId);
        }
        const full = (await tx.viaje.findFirstOrThrow({
          where: { id, tenantId },
          include: VIAJE_INCLUDE_FULL,
        })) as unknown as ViajeConVehiculosViaje;
        const fullSinIva = this.zerarIvaTransportistaSiDeshabilitado(
          full,
          ivaTransportistaHabilitado,
        );
        return enrichViajeConGananciaBruta(
          calcularMontosReales(fullSinIva) as any,
        ) as ViajeConVehiculosViaje;
      }, VIAJE_INTERACTIVE_TX);
    } catch (e) {
      this.assertNoUniqueConstraintViolation(e);
    }
  }

  /**
   * Documentos del viaje (remito, carta de porte, fotos…): hasta 3 y 10 MB entre todos.
   * El tope se controla acá con el tamaño real del archivo subido (no con lo que diga el
   * cliente). Son datos operativos: se pueden agregar/quitar en cualquier etapa.
   */
  async addAdjunto(
    id: string,
    tenantId: string,
    userId: string,
    file: Express.Multer.File | undefined,
    tituloRaw: string | undefined,
  ) {
    if (!file) throw new BadRequestException("Se requiere un archivo.");
    const titulo = String(tituloRaw ?? "").trim();
    if (!titulo) throw new BadRequestException("Ingresá un título para el documento.");
    if (titulo.length > 120) {
      throw new BadRequestException("El título no puede superar 120 caracteres.");
    }
    const esPdf =
      file.mimetype === "application/pdf" ||
      file.originalname?.toLowerCase().endsWith(".pdf");
    if (!esPdf && !file.mimetype?.startsWith("image/")) {
      throw new BadRequestException("El documento tiene que ser un PDF o una imagen.");
    }

    const viaje = await this.prisma.viaje.findFirst({
      where: { id, tenantId },
      select: { adjuntos: true },
    });
    if (!viaje) throw new NotFoundException("Viaje no encontrado");
    const actuales = adjuntosDeViaje(viaje.adjuntos);
    const activos = adjuntosActivos(actuales);
    if (activos.length >= MAX_ADJUNTOS_VIAJE) {
      throw new BadRequestException(
        `El viaje ya tiene ${MAX_ADJUNTOS_VIAJE} documentos. Quitá uno para agregar otro.`,
      );
    }
    const usados = activos.reduce((acc, a) => acc + a.bytes, 0);
    if (usados + file.size > MAX_BYTES_ADJUNTOS_VIAJE) {
      throw new BadRequestException(
        "Los documentos del viaje no pueden superar 10 MB en total.",
      );
    }

    const url = await this.cloudinary.uploadViajeAdjunto(
      tenantId,
      file.buffer,
      file.originalname,
      file.mimetype,
    );
    const nuevo: ViajeAdjunto = {
      id: randomUUID(),
      url,
      titulo,
      nombre: file.originalname || "documento",
      bytes: file.size,
      mimeType: file.mimetype,
      createdAt: new Date().toISOString(),
      createdBy: userId,
    };
    await this.prisma.viaje.updateMany({
      where: { id, tenantId },
      data: { adjuntos: [...actuales, nuevo] as unknown as Prisma.InputJsonValue },
    });
    return this.findOne(id, tenantId);
  }

  /**
   * Quita un documento del viaje: lo borra de Cloudinary y lo deja marcado como borrado
   * (no se elimina de la lista), con `archivoEliminado` indicando si el borrado del
   * archivo salió bien. Si Cloudinary falla, quitar el documento igual funciona.
   */
  async deleteAdjunto(
    id: string,
    tenantId: string,
    userId: string,
    adjuntoId: string,
  ) {
    const viaje = await this.prisma.viaje.findFirst({
      where: { id, tenantId },
      select: { adjuntos: true },
    });
    if (!viaje) throw new NotFoundException("Viaje no encontrado");
    const actuales = adjuntosDeViaje(viaje.adjuntos);
    const doc = adjuntosActivos(actuales).find((a) => a.id === adjuntoId);
    if (!doc) throw new NotFoundException("Documento no encontrado");

    const archivoEliminado = await this.cloudinary.eliminarArchivo(
      doc.url,
      this.cloudinary.viajesFolder(tenantId),
    );
    const borradoAt = new Date().toISOString();
    await this.prisma.viaje.updateMany({
      where: { id, tenantId },
      data: {
        adjuntos: actuales.map((a) =>
          a.id === adjuntoId
            ? { ...a, borradoAt, borradoPor: userId, archivoEliminado }
            : a,
        ) as unknown as Prisma.InputJsonValue,
      },
    });
    return this.findOne(id, tenantId);
  }

  async addGasto(
    id: string,
    tenantId: string,
    userId: string,
    dto: AddGastoDto,
  ) {
    const viaje = await this.findOne(id, tenantId);

    const facturacionBloqueaGasto = !(
      FACTURACION_ESTADOS_DISPONIBLES as readonly string[]
    ).includes((viaje as any).facturacionEstado);
    if (viaje.etapa === "cancelado" || facturacionBloqueaGasto) {
      throw new BadRequestException(
        "No se pueden agregar gastos a un viaje facturado o cancelado.",
      );
    }

    const gastosActuales = Array.isArray(viaje.otrosGastos)
      ? (viaje.otrosGastos as Array<Record<string, unknown>>)
      : [];

    const nuevoGasto: Record<string, unknown> = {
      descripcion: dto.descripcion.trim(),
      monto: dto.monto,
      moneda: dto.moneda,
      createdBy: userId,
    };
    if (dto.fecha) nuevoGasto.fecha = dto.fecha;

    const gastosActualizados = [...gastosActuales, nuevoGasto];

    return this.prisma.$transaction(async (tx) => {
      await tx.viaje.update({
        where: { id },
        data: {
          otrosGastos: gastosActualizados as unknown as Prisma.InputJsonValue,
        },
      });

      const full = (await tx.viaje.findFirstOrThrow({
        where: { id, tenantId },
        include: VIAJE_INCLUDE_FULL,
      })) as unknown as ViajeConVehiculosViaje;

      return calcularMontosReales(full);
    }, VIAJE_INTERACTIVE_TX);
  }

  async addPagoTransportista(
    id: string,
    tenantId: string,
    userId: string,
    dto: AddPagoTransportistaDto,
  ) {
    const ivaTransportistaHabilitado =
      await this.ivaTransportistaHabilitado(tenantId);
    const viaje = await this.findOne(id, tenantId);

    if (viaje.etapa === "cancelado") {
      throw new BadRequestException(
        "No se pueden registrar pagos en un viaje cancelado.",
      );
    }
    if (!viaje.transportistaId) {
      throw new BadRequestException(
        "Este viaje no tiene transportista externo asignado.",
      );
    }

    const pagosActuales = Array.isArray(viaje.pagosTransportista)
      ? (viaje.pagosTransportista as Array<Record<string, unknown>>)
      : [];

    const nuevoPago: Record<string, unknown> = {
      monto: dto.monto,
      moneda: dto.moneda,
      fecha: dto.fecha,
      createdBy: userId,
      createdAt: new Date().toISOString(),
    };
    if (dto.observaciones?.trim())
      nuevoPago.observaciones = dto.observaciones.trim();
    if (dto.comprobante?.trim()) nuevoPago.comprobante = dto.comprobante.trim();

    const pagosActualizados = [...pagosActuales, nuevoPago];

    this.assertPagosTransportistaNoSuperanSaldo(
      {
        id: viaje.id,
        transportistaId: viaje.transportistaId,
        precioTransportistaExterno: viaje.precioTransportistaExterno,
        monedaPrecioTransportistaExterno: viaje.monedaPrecioTransportistaExterno,
        precioTransportistaIvaIncluidoPct: (viaje as any)
          .precioTransportistaIvaIncluidoPct,
        pagosTransportista: pagosActualizados,
        liquidacionesViaje: (viaje as any).liquidacionesViaje,
      },
      ivaTransportistaHabilitado,
    );

    const monedaAcordada =
      viaje.monedaPrecioTransportistaExterno === "USD" ? "USD" : "ARS";
    const totalPagado = pagosActualizados
      .filter((p) => ((p as { moneda?: string }).moneda === "USD" ? "USD" : "ARS") === monedaAcordada)
      .reduce((acc, p) => acc + (Number((p as { monto?: number }).monto) || 0), 0);

    return this.prisma.$transaction(async (tx) => {
      await tx.viaje.update({
        where: { id },
        data: {
          pagosTransportista:
            pagosActualizados as unknown as Prisma.InputJsonValue,
        },
      });
      await this.sincronizarCargoCcTransportista(
        tx,
        tenantId,
        id,
        viaje.transportistaId!,
        monedaAcordada,
        totalPagado,
      );
      const out = await tx.viaje.findFirstOrThrow({
        where: { id, tenantId },
        include: VIAJE_INCLUDE_FULL,
      });
      return calcularMontosReales(
        this.zerarIvaTransportistaSiDeshabilitado(out, ivaTransportistaHabilitado),
      ) as unknown as ViajeConVehiculosViaje;
    }, VIAJE_INTERACTIVE_TX);
  }

  async deletePagoTransportista(
    id: string,
    tenantId: string,
    userId: string,
    index: number,
  ) {
    const ivaTransportistaHabilitado =
      await this.ivaTransportistaHabilitado(tenantId);
    const viaje = await this.findOne(id, tenantId);

    if (viaje.etapa === "cancelado") {
      throw new BadRequestException(
        "No se pueden eliminar pagos en un viaje cancelado.",
      );
    }
    if (!viaje.transportistaId) {
      throw new BadRequestException(
        "Este viaje no tiene transportista externo asignado.",
      );
    }

    const pagosActuales = Array.isArray(viaje.pagosTransportista)
      ? (viaje.pagosTransportista as Array<Record<string, unknown>>)
      : [];

    if (index < 0 || index >= pagosActuales.length) {
      throw new BadRequestException("Pago inválido.");
    }

    const pagosActualizados = pagosActuales.filter((_, idx) => idx !== index);

    const monedaAcordada =
      viaje.monedaPrecioTransportistaExterno === "USD" ? "USD" : "ARS";
    const totalPagado = pagosActualizados
      .filter((p) => ((p as { moneda?: string }).moneda === "USD" ? "USD" : "ARS") === monedaAcordada)
      .reduce((acc, p) => acc + (Number((p as { monto?: number }).monto) || 0), 0);

    return this.prisma.$transaction(async (tx) => {
      await tx.viaje.update({
        where: { id },
        data: {
          pagosTransportista:
            pagosActualizados as unknown as Prisma.InputJsonValue,
        },
      });
      await this.sincronizarCargoCcTransportista(
        tx,
        tenantId,
        id,
        viaje.transportistaId!,
        monedaAcordada,
        totalPagado,
      );
      const out = await tx.viaje.findFirstOrThrow({
        where: { id, tenantId },
        include: VIAJE_INCLUDE_FULL,
      });
      return calcularMontosReales(
        this.zerarIvaTransportistaSiDeshabilitado(out, ivaTransportistaHabilitado),
      ) as unknown as ViajeConVehiculosViaje;
    }, VIAJE_INTERACTIVE_TX);
  }

  async getViajesSaldoPendienteTransportista(tenantId: string) {
    const ivaTransportistaHabilitado =
      await this.ivaTransportistaHabilitado(tenantId);
    const viajes = await this.prisma.viaje.findMany({
      where: {
        tenantId,
        transportistaId: { not: null },
        precioTransportistaExterno: { gt: 0 },
      },
      orderBy: { createdAt: "desc" },
      include: {
        cliente: { select: { id: true, nombre: true } },
        transportista: { select: { id: true, nombre: true } },
        factura: { select: { id: true, numero: true } },
        liquidacionesViaje: {
          include: {
            liquidacion: {
              include: {
                conceptosLineas: true,
                viajes: true,
              },
            },
          },
        },
      },
    });

    return viajes
      .filter((v) => {
        const moneda =
          v.monedaPrecioTransportistaExterno === "USD" ? "USD" : "ARS";

        const acordado = this.calcularAcordado(v, ivaTransportistaHabilitado);

        const pagos = Array.isArray(v.pagosTransportista)
          ? (v.pagosTransportista as Array<{ monto?: number; moneda?: string }>)
          : [];
        const pagado = pagos
          .filter(
            (p) => ((p.moneda ?? "ARS") === "USD" ? "USD" : "ARS") === moneda,
          )
          .reduce(
            (acc, p) => acc + (typeof p.monto === "number" ? p.monto : 0),
            0,
          );
        return pagado < acordado;
      })
      .map((v) =>
        this.zerarIvaTransportistaSiDeshabilitado(v, ivaTransportistaHabilitado),
      );
  }

  async remove(id: string, tenantId: string, force = false) {
    const viaje = await this.prisma.viaje.findFirst({
      where: { id, tenantId },
      select: {
        id: true,
        liquidacionesViaje: {
          select: {
            liquidacion: {
              select: {
                id: true,
                estado: true,
                cae: true,
                cbteNro: true,
                ptoVenta: true,
                periodoDesde: true,
                periodoHasta: true,
                transportista: { select: { nombre: true } },
              },
            },
          },
        },
      },
    });
    if (!viaje) throw new NotFoundException("Viaje no encontrado");

    const liquidaciones = [
      ...new Map(
        viaje.liquidacionesViaje.map((lv) => [
          lv.liquidacion.id,
          lv.liquidacion,
        ]),
      ).values(),
    ];

    const toImpactoDto = (l: (typeof liquidaciones)[number]) => ({
      id: l.id,
      transportistaNombre: l.transportista.nombre,
      estado: l.estado,
      tieneCae: Boolean(l.cae),
      cbteNro: l.cbteNro,
      ptoVenta: l.ptoVenta,
      periodoDesde: l.periodoDesde,
      periodoHasta: l.periodoHasta,
    });

    const autorizadas = liquidaciones.filter(
      (l) => l.estado === "autorizado" || l.estado === "anulado",
    );
    if (autorizadas.length > 0) {
      throw new ConflictException({
        message:
          "No se puede eliminar el viaje: está incluido en una liquidación ya autorizada o anulada en AFIP.",
        code: "VIAJE_LIQUIDACION_AUTORIZADA",
        liquidaciones: autorizadas.map(toImpactoDto),
      });
    }

    if (liquidaciones.length > 0 && !force) {
      throw new ConflictException({
        message:
          "Este viaje está incluido en liquidaciones que todavía no fueron autorizadas por AFIP. Si continuás, también se van a eliminar.",
        code: "VIAJE_TIENE_LIQUIDACIONES",
        liquidaciones: liquidaciones.map(toImpactoDto),
      });
    }

    return this.prisma.$transaction(async (tx) => {
      for (const liq of liquidaciones) {
        await tx.liquidacionViaje.deleteMany({
          where: { liquidacionId: liq.id, viajeId: id },
        });
        const restantes = await tx.liquidacionViaje.count({
          where: { liquidacionId: liq.id },
        });
        if (restantes === 0) {
          await tx.liquidacion.delete({ where: { id: liq.id } });
        }
      }
      const { count } = await tx.viaje.deleteMany({ where: { id, tenantId } });
      if (count === 0) throw new NotFoundException("Viaje no encontrado");
      return { id };
    });
  }
}

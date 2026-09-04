import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../../shared/prisma/prisma.service";
import { LiquidacionesService } from "../liquidaciones-arca/liquidaciones.service";
import { FacturacionService } from "../facturacion/facturacion.service";

interface ViajeParaAgrupar {
  id: string;
  transportistaId: string | null;
  clienteId: string;
  fechaCarga: Date | null;
  cantidadTransportista: number | null;
  precioUnitarioTransportista: number | null;
  monto: number | null;
  monedaMonto: string;
}

export interface LiquidacionPreviewGrupo {
  transportistaId: string;
  transportistaNombre: string;
  cantidadViajes: number;
  periodoDesde: string;
  periodoHasta: string;
  bruto: number;
}

export interface FacturaClientePreviewGrupo {
  clienteId: string;
  clienteNombre: string;
  cantidadViajes: number;
  importe: number;
  moneda: string;
}

/**
 * Etapas opcionales del import que corren DESPUÉS de que los viajes ya están
 * creados y guardados: generar liquidaciones borrador (agrupado por
 * transportista) y facturar a clientes (agrupado por cliente). Ninguna se
 * ejecuta automáticamente — cada una tiene su propio preview antes de crear
 * nada, y ninguna emite comprobantes a AFIP.
 */
@Injectable()
export class ImportacionesPostViajesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly liquidaciones: LiquidacionesService,
    private readonly facturacion: FacturacionService,
  ) {}

  private async tieneModulo(tenantId: string, modulo: string): Promise<boolean> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { clerkOrgId: tenantId },
      select: { modules: true },
    });
    return tenant?.modules.includes(modulo) ?? false;
  }

  private async viajesParaAgrupar(
    tenantId: string,
    viajeIds: string[],
  ): Promise<ViajeParaAgrupar[]> {
    const viajes = await this.prisma.viaje.findMany({
      where: { id: { in: viajeIds }, tenantId },
      select: {
        id: true,
        transportistaId: true,
        clienteId: true,
        fechaCarga: true,
        cantidadTransportista: true,
        precioUnitarioTransportista: true,
        monto: true,
        monedaMonto: true,
      },
    });
    if (viajes.length !== viajeIds.length) {
      throw new BadRequestException(
        "Alguno de los viajes indicados no existe o no pertenece al tenant.",
      );
    }
    return viajes;
  }

  private periodoDesdeHasta(fechas: (Date | null)[]): { desde: string; hasta: string } {
    const validas = fechas.filter((f): f is Date => f != null);
    const hoy = new Date().toISOString().slice(0, 10);
    if (validas.length === 0) return { desde: hoy, hasta: hoy };
    const ts = validas.map((f) => f.getTime());
    return {
      desde: new Date(Math.min(...ts)).toISOString().slice(0, 10),
      hasta: new Date(Math.max(...ts)).toISOString().slice(0, 10),
    };
  }

  // ── Liquidaciones borrador (agrupadas por transportista) ──────────────

  async previewLiquidaciones(
    tenantId: string,
    viajeIds: string[],
  ): Promise<LiquidacionPreviewGrupo[]> {
    const tieneFacturacion = await this.tieneModulo(tenantId, "facturacion");
    const tieneLiquidoProductoArca = await this.tieneModulo(
      tenantId,
      "emision-liquido-producto-arca",
    );
    if (!tieneFacturacion && !tieneLiquidoProductoArca) {
      throw new BadRequestException(
        "Este tenant no tiene facturación ni emisión de líquido producto ARCA — no aplica generar liquidaciones.",
      );
    }
    const viajes = await this.viajesParaAgrupar(tenantId, viajeIds);
    const conTransportista = viajes.filter((v) => v.transportistaId);

    const porTransportista = new Map<string, ViajeParaAgrupar[]>();
    for (const v of conTransportista) {
      const key = v.transportistaId!;
      (porTransportista.get(key) ?? porTransportista.set(key, []).get(key)!).push(v);
    }
    if (porTransportista.size === 0) return [];

    const transportistas = await this.prisma.transportista.findMany({
      where: { id: { in: [...porTransportista.keys()] }, tenantId },
      select: { id: true, nombre: true },
    });
    const nombreById = new Map(transportistas.map((t) => [t.id, t.nombre]));

    return [...porTransportista.entries()].map(([transportistaId, grupo]) => {
      const { desde, hasta } = this.periodoDesdeHasta(grupo.map((v) => v.fechaCarga));
      const bruto = grupo.reduce((sum, v) => {
        if (v.cantidadTransportista != null && v.precioUnitarioTransportista != null) {
          return sum + v.cantidadTransportista * v.precioUnitarioTransportista;
        }
        return sum;
      }, 0);
      return {
        transportistaId,
        transportistaNombre: nombreById.get(transportistaId) ?? transportistaId,
        cantidadViajes: grupo.length,
        periodoDesde: desde,
        periodoHasta: hasta,
        bruto: Math.round(bruto * 100) / 100,
      };
    });
  }

  async confirmarLiquidaciones(
    tenantId: string,
    userId: string,
    viajeIds: string[],
  ) {
    const tieneFacturacion = await this.tieneModulo(tenantId, "facturacion");
    const tieneLiquidoProductoArca = await this.tieneModulo(
      tenantId,
      "emision-liquido-producto-arca",
    );
    if (!tieneFacturacion && !tieneLiquidoProductoArca) {
      throw new BadRequestException(
        "Este tenant no tiene facturación ni emisión de líquido producto ARCA — no aplica generar liquidaciones.",
      );
    }
    const viajes = await this.viajesParaAgrupar(tenantId, viajeIds);
    const porTransportista = new Map<string, ViajeParaAgrupar[]>();
    for (const v of viajes) {
      if (!v.transportistaId) continue;
      const key = v.transportistaId;
      (porTransportista.get(key) ?? porTransportista.set(key, []).get(key)!).push(v);
    }

    const creadas = [];
    for (const [transportistaId, grupo] of porTransportista) {
      const { desde, hasta } = this.periodoDesdeHasta(grupo.map((v) => v.fechaCarga));
      // Reutiliza el cálculo (bruto, comisión, IVA) de createLiquidacion en
      // vez de reimplementarlo — mismo criterio que la liquidación manual.
      const liquidacion = await this.liquidaciones.createLiquidacion(tenantId, userId, {
        transportistaId,
        periodoDesde: desde,
        periodoHasta: hasta,
        viajeIds: grupo.map((v) => v.id),
      });
      creadas.push(liquidacion);
    }
    return creadas;
  }

  // ── Facturar a clientes (agrupado por cliente) ─────────────────────────

  async previewFacturasClientes(
    tenantId: string,
    viajeIds: string[],
  ): Promise<FacturaClientePreviewGrupo[]> {
    const tieneArca = await this.tieneModulo(tenantId, "emision-facturas-arca");
    const tieneFacturacion = await this.tieneModulo(tenantId, "facturacion");
    if (!tieneArca && !tieneFacturacion) {
      throw new BadRequestException(
        "Este tenant no tiene facturación ni integración con ARCA — no aplica facturar a clientes.",
      );
    }
    const viajes = await this.viajesParaAgrupar(tenantId, viajeIds);

    const porCliente = new Map<string, ViajeParaAgrupar[]>();
    for (const v of viajes) {
      const key = v.clienteId;
      (porCliente.get(key) ?? porCliente.set(key, []).get(key)!).push(v);
    }
    if (porCliente.size === 0) return [];

    const clientes = await this.prisma.cliente.findMany({
      where: { id: { in: [...porCliente.keys()] }, tenantId },
      select: { id: true, nombre: true },
    });
    const nombreById = new Map(clientes.map((c) => [c.id, c.nombre]));

    return [...porCliente.entries()].map(([clienteId, grupo]) => ({
      clienteId,
      clienteNombre: nombreById.get(clienteId) ?? clienteId,
      cantidadViajes: grupo.length,
      importe: Math.round(grupo.reduce((s, v) => s + (v.monto ?? 0), 0) * 100) / 100,
      moneda: grupo[0]?.monedaMonto ?? "ARS",
    }));
  }

  async confirmarFacturasClientes(
    tenantId: string,
    viajeIds: string[],
    numerosPorCliente: Record<string, string> | undefined,
  ) {
    const tieneArca = await this.tieneModulo(tenantId, "emision-facturas-arca");
    const tieneFacturacion = await this.tieneModulo(tenantId, "facturacion");
    if (!tieneArca && !tieneFacturacion) {
      throw new BadRequestException(
        "Este tenant no tiene facturación ni integración con ARCA — no aplica facturar a clientes.",
      );
    }
    const viajes = await this.viajesParaAgrupar(tenantId, viajeIds);
    const porCliente = new Map<string, ViajeParaAgrupar[]>();
    for (const v of viajes) {
      const key = v.clienteId;
      (porCliente.get(key) ?? porCliente.set(key, []).get(key)!).push(v);
    }

    const hoy = new Date().toISOString().slice(0, 10);
    const creadas = [];
    for (const [clienteId, grupo] of porCliente) {
      // Sin ARCA, el número representa un comprobante ya numerado
      // externamente — obligatorio. Con ARCA, se crea en borrador sin
      // número: AFIP lo asigna recién al emitir (ver fix de Factura.numero).
      const numero = numerosPorCliente?.[clienteId];
      if (!tieneArca && !numero) {
        throw new BadRequestException(
          `Falta el número de factura para el cliente ${clienteId} (obligatorio para tenants sin ARCA).`,
        );
      }
      const factura = await this.facturacion.createFactura(tenantId, {
        tipo: "cliente",
        clienteId,
        viajeIds: grupo.map((v) => v.id),
        fechaEmision: hoy,
        numero: tieneArca ? undefined : numero,
      });
      creadas.push(factura);
    }
    return creadas;
  }
}

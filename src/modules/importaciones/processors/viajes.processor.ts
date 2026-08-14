import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client"; // Importante: necesario para capturar errores específicos
import { PrismaService } from "../../../shared/prisma/prisma.service";
import { generateNumeroViaje } from "../../viajes/generate-viaje-numero";
import { syncLiquidacionEstadoViaje } from "../../viajes/viaje-estado-financiero";
import type { IImportProcessor } from "./import-processor.interface";
import type { ValidatedRow } from "../types/import.types";

@Injectable()
export class ViajesProcessor implements IImportProcessor {
  constructor(private readonly prisma: PrismaService) {}

  /** cantidadFactura × precioUnitarioFactura tiene prioridad sobre `monto` directo (retrocompatible con templates viejos que solo mandan MONTO). */
  private resolveMonto(row: ValidatedRow): number | null {
    const cantidad =
      row.cantidadFactura != null ? Number(row.cantidadFactura) : null;
    const precioUnit =
      row.precioUnitarioFactura != null
        ? Number(row.precioUnitarioFactura)
        : null;
    if (cantidad != null && precioUnit != null) {
      return cantidad * precioUnit;
    }
    return row.monto != null ? Number(row.monto) : null;
  }

  async insert(
    row: ValidatedRow,
    tenantId: string,
    createdBy: string,
  ): Promise<string> {
    try {
      const numeroIdentificacionPersonalizado =
        (row.numeroIdentificacionPersonalizado as string | null)
          ?.toString()
          .trim() || null;

      // Sin ID Personalizado no hay forma de detectar que una fila ya se
      // importó antes: reimportar el mismo archivo duplicaría el viaje. Se
      // valida acá además de en el template (defensa en profundidad, por si
      // un template viejo lo tiene guardado como no obligatorio).
      if (!numeroIdentificacionPersonalizado) {
        throw new Error(
          "El ID Personalizado es obligatorio: sin él no se puede detectar si el viaje ya fue importado antes, y reimportar el archivo lo duplicaría.",
        );
      }

      // ── Upsert por ID Personalizado ───────────────────────────────────
      // Reimportar el mismo ID Personalizado actualiza el viaje existente
      // en vez de duplicarlo (uso recurrente esperado, no solo carga única).
      const existing = await this.prisma.viaje.findFirst({
        where: { tenantId, numeroIdentificacionPersonalizado },
        select: { id: true },
      });
      if (existing) {
        return await this.update(existing.id, row, tenantId);
      }

      return await this.create(row, tenantId, createdBy);
    } catch (error) {
      // Limpiamos los errores y los lanzamos nuevamente como Error estándar
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        // Fallo de unicidad (P2002) - Ej: Factura duplicada, ID Personalizado duplicado
        if (error.code === "P2002") {
          const campos =
            (error.meta?.target as string[])?.join(", ") || "desconocidos";
          throw new Error(
            `Error de duplicidad: Ya existe un registro con el mismo valor en los campos: (${campos}).`,
          );
        }
        // Otros fallos conocidos de Prisma
        throw new Error(`Error en la base de datos (Código: ${error.code}).`);
      }

      if (error instanceof Error) {
        // Relanzamos los errores controlados (como los de "fecha de carga requerida")
        throw error;
      }

      // Fallback para cualquier otra cosa
      throw new Error("Ocurrió un error inesperado al procesar la fila.");
    }
  }

  /**
   * Actualiza los campos operativos/financieros de un viaje ya existente
   * (matcheado por ID Personalizado). A propósito NO re-vincula vehículo ni
   * re-crea facturas — esos efectos quedan limitados a la creación inicial,
   * para no duplicarlos en reimportaciones sucesivas del mismo archivo.
   */
  private async update(
    viajeId: string,
    row: ValidatedRow,
    tenantId: string,
  ): Promise<string> {
    const clienteId = row.clienteId as string;
    const fechaCarga = (row.fechaCarga as Date | null) ?? undefined;
    const fechaDescarga = (row.fechaDescarga as Date | null) ?? undefined;

    // Campos opcionales: `undefined` (no `null`) cuando la celda viene vacía,
    // para que reimportar el mismo ID Personalizado con un Excel más acotado
    // no borre datos ya cargados que esa fila no trae.
    await this.prisma.$transaction(async (tx) => {
      await tx.viaje.update({
        where: { id: viajeId },
        data: {
          clienteId,
          transportistaId: (row.transportistaId as string | null) ?? undefined,
          choferId: (row.choferId as string | null) ?? undefined,
          origen: (row.origen as string | null) ?? undefined,
          destino: (row.destino as string | null) ?? undefined,
          fechaCarga,
          fechaDescarga,
          detalleCarga: (row.detalleCarga as string | null) ?? undefined,
          kmRecorridos:
            row.kmRecorridos != null ? Number(row.kmRecorridos) : undefined,
          monto: this.resolveMonto(row) ?? undefined,
          monedaMonto: (row.monedaMonto as string | null) ?? undefined,
          cantidadFactura:
            row.cantidadFactura != null
              ? Number(row.cantidadFactura)
              : undefined,
          precioUnitarioFactura:
            row.precioUnitarioFactura != null
              ? Number(row.precioUnitarioFactura)
              : undefined,
          cantidadTransportista:
            row.cantidadTransportista != null
              ? Number(row.cantidadTransportista)
              : undefined,
          precioUnitarioTransportista:
            row.precioUnitarioTransportista != null
              ? Number(row.precioUnitarioTransportista)
              : undefined,
          precioTransportistaExterno:
            row.precioTransportistaExterno != null
              ? Number(row.precioTransportistaExterno)
              : undefined,
          monedaPrecioTransportistaExterno:
            (row.monedaPrecioTransportistaExterno as string | null) ??
            undefined,
        },
      });
      // El transportista puede haber cambiado — resincronizar.
      await syncLiquidacionEstadoViaje(tx, tenantId, viajeId);
    });

    return viajeId;
  }

  private async create(
    row: ValidatedRow,
    tenantId: string,
    createdBy: string,
  ): Promise<string> {
    // Envolvemos todas las operaciones de la fila en una transacción interactiva
    return await this.prisma.$transaction(async (tx) => {
      // Pasamos 'tx' (el cliente transaccional) a tu generador para mantener la consistencia
      // (Forzamos el tipo con 'as any' en caso de que generateNumeroViaje espere estrictamente PrismaService en tu tipado)
      const numero = await generateNumeroViaje(tx as any, tenantId);

      const observacionesParts: string[] = [];
      if (row.observaciones)
        observacionesParts.push(row.observaciones as string);
      if (row._unmappedText)
        observacionesParts.push(row._unmappedText as string);
      const observaciones = observacionesParts.join("\n") || null;

      const clienteId = row.clienteId as string;
      const fechaCarga = (row.fechaCarga as Date | null) ?? null;
      const fechaDescarga = (row.fechaDescarga as Date | null) ?? null;

      if (!fechaCarga) throw new Error("La fecha de carga es requerida.");
      if (!fechaDescarga)
        throw new Error("La fecha de descarga es requerida.");

      // ── Clasificación explícita de flota ──────────────────────────────
      // No se infiere nada destructivo. Si la columna TIPO DE FLOTA no viene
      // en el Excel (imports viejos), `tipoFlota` queda null y el viaje se
      // persiste tal cual — comportamiento retrocompatible. Cuando SÍ viene,
      // se valida la coherencia y se corta con error de fila antes de crear
      // un viaje con datos financieros perdidos.
      const tipoFlota =
        typeof row.tipoFlota === "string"
          ? row.tipoFlota.toUpperCase()
          : null;
      const transportistaId = (row.transportistaId as string | null) ?? null;
      const precioFlete =
        row.precioTransportistaExterno != null
          ? Number(row.precioTransportistaExterno)
          : null;

      if (tipoFlota === "TERCERO") {
        if (!transportistaId)
          throw new Error(
            "Flota TERCERO sin transportista: completá la columna TRANSPORTE.",
          );
        if (precioFlete == null)
          throw new Error(
            "Flota TERCERO sin VALOR FLETERO: se perdería el costo del flete.",
          );
      }
      if (tipoFlota === "PROPIA" && transportistaId)
        throw new Error(
          "Flota PROPIA con transportista externo asignado: datos incoherentes.",
        );

      const hoy = new Date();
      hoy.setHours(0, 0, 0, 0);

      let facturaClienteId: string | null = null;
      if (row.nroFactura) {
        const fechaEmision =
          (row.fechaEmisionFactura as Date | null) ?? fechaCarga ?? new Date();

        // 2. Cambiamos this.prisma por tx
        const factura = await tx.factura.create({
          data: {
            tenantId,
            numero: row.nroFactura as string,
            tipo: "cliente",
            clienteId,
            importe: row.monto != null ? Number(row.monto) : 0,
            fechaEmision,
            fechaVencimiento:
              (row.fechaVencimientoFactura as Date | null) ?? null,
            estado: "pendiente",
          },
          select: { id: true },
        });
        facturaClienteId = factura.id;
      }

      const etapa = (() => {
        if (fechaDescarga && fechaDescarga <= hoy) return "finalizado";
        if (fechaCarga && fechaCarga <= hoy) return "en_curso";
        return "pendiente";
      })();
      const facturacionEstado = facturaClienteId ? "facturado" : "sin_facturar";

      const numeroIdentificacionPersonalizado =
        (row.numeroIdentificacionPersonalizado as string | null)
          ?.toString()
          .trim() || null;

      // Usamos tx para el viaje
      const viaje = await tx.viaje.create({
        data: {
          tenantId,
          numero,
          numeroIdentificacionPersonalizado,
          etapa,
          facturacionEstado,
          clienteId,
          transportistaId,
          choferId: (row.choferId as string | null) ?? null,
          origen: (row.origen as string | null) ?? null,
          destino: (row.destino as string | null) ?? null,
          fechaCarga,
          fechaDescarga,
          detalleCarga: (row.detalleCarga as string | null) ?? null,
          kmRecorridos:
            row.kmRecorridos != null ? Number(row.kmRecorridos) : null,
          monto: this.resolveMonto(row),
          monedaMonto: (row.monedaMonto as string | null) ?? "ARS",
          cantidadFactura:
            row.cantidadFactura != null ? Number(row.cantidadFactura) : null,
          precioUnitarioFactura:
            row.precioUnitarioFactura != null
              ? Number(row.precioUnitarioFactura)
              : null,
          cantidadTransportista:
            row.cantidadTransportista != null
              ? Number(row.cantidadTransportista)
              : null,
          precioUnitarioTransportista:
            row.precioUnitarioTransportista != null
              ? Number(row.precioUnitarioTransportista)
              : null,
          precioTransportistaExterno: precioFlete,
          monedaPrecioTransportistaExterno:
            (row.monedaPrecioTransportistaExterno as string | null) ?? "ARS",
          facturaId: facturaClienteId,
          observaciones,
          otrosGastos: this.extractOtrosGastos(row),
          createdBy,
        },
        select: { id: true },
      });
      // Igual que en la creación manual: sin esto, un viaje con transportista en un
      // tenant con ARCA queda en liquidacionEstado null en vez de "sin_liquidar".
      await syncLiquidacionEstadoViaje(tx, tenantId, viaje.id);

      if (row.vehiculoId) {
        // Usamos tx para el vehículo
        await tx.viajeVehiculo.create({
          data: {
            tenantId,
            viajeId: viaje.id,
            vehiculoId: row.vehiculoId as string,
            orden: 0,
          },
        });
      }

      if (row.nroFacturaTransporte) {
        const fechaEmision =
          (row.fechaEmisionFacturaTransp as Date | null) ??
          fechaCarga ??
          new Date();
        // Usamos tx para la factura externa.
        // Vinculamos transportista y moneda para no perder la trazabilidad
        // financiera del flete (antes la factura quedaba huérfana y en ARS).
        await tx.factura.create({
          data: {
            tenantId,
            numero: row.nroFacturaTransporte as string,
            tipo: "transportista_externo",
            transportistaId,
            importe: precioFlete ?? 0,
            moneda:
              (row.monedaPrecioTransportistaExterno as string | null) ??
              "ARS",
            fechaEmision,
            fechaVencimiento:
              (row.fechaVencimientoFacturaTransp as Date | null) ?? null,
            estado: "pendiente",
          },
        });
      }

      return viaje.id;
    });
  }

  /** Extrae hasta 5 "otros gastos" desde campos con nombre otroGasto1Desc / otroGasto1Monto, etc. */
  private extractOtrosGastos(row: ValidatedRow): object[] {
    const gastos: object[] = [];
    for (let i = 1; i <= 5; i++) {
      const desc = row[`otroGasto${i}Desc`];
      const monto = row[`otroGasto${i}Monto`];
      if (!desc && monto == null) continue;
      const monedaRaw = String(row[`otroGasto${i}Moneda`] ?? "ARS")
        .trim()
        .toUpperCase();
      const moneda = monedaRaw === "USD" ? "USD" : "ARS";
      const fechaVal = row[`otroGasto${i}Fecha`];
      const gasto: Record<string, unknown> = {
        descripcion: String(desc ?? "").trim(),
        monto: monto != null ? Number(monto) : 0,
        moneda,
      };
      if (fechaVal instanceof Date) {
        gasto.fecha = fechaVal.toISOString().slice(0, 10);
      } else if (fechaVal) {
        gasto.fecha = String(fechaVal).trim();
      }
      gastos.push(gasto);
    }
    return gastos;
  }
}

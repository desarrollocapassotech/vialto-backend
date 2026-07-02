import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client"; // Importante: necesario para capturar errores específicos
import { PrismaService } from "../../../shared/prisma/prisma.service";
import { generateNumeroViaje } from "../../viajes/generate-viaje-numero";
import type { IImportProcessor } from "./import-processor.interface";
import type { ValidatedRow } from "../types/import.types";

@Injectable()
export class ViajesProcessor implements IImportProcessor {
  constructor(private readonly prisma: PrismaService) {}

  async insert(
    row: ValidatedRow,
    tenantId: string,
    createdBy: string,
  ): Promise<string> {
    try {
      // 1. Envolvemos todas las operaciones de la fila en una transacción interactiva
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

        const hoy = new Date();
        hoy.setHours(0, 0, 0, 0);

        let facturaClienteId: string | null = null;
        if (row.nroFactura) {
          const fechaEmision =
            (row.fechaEmisionFactura as Date | null) ??
            fechaCarga ??
            new Date();

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

        const estado = (() => {
          if (fechaDescarga && fechaDescarga <= hoy) {
            return facturaClienteId
              ? "facturado_sin_cobrar"
              : "finalizado_sin_facturar";
          }
          if (fechaCarga && fechaCarga <= hoy) return "en_curso";
          return "pendiente";
        })();

        // Usamos tx para el viaje
        const viaje = await tx.viaje.create({
          data: {
            tenantId,
            numero,
            estado,
            clienteId,
            transportistaId: (row.transportistaId as string | null) ?? null,
            choferId: (row.choferId as string | null) ?? null,
            origen: (row.origen as string | null) ?? null,
            destino: (row.destino as string | null) ?? null,
            fechaCarga,
            fechaDescarga,
            detalleCarga: (row.detalleCarga as string | null) ?? null,
            kmRecorridos:
              row.kmRecorridos != null ? Number(row.kmRecorridos) : null,
            monto: row.monto != null ? Number(row.monto) : null,
            monedaMonto: (row.monedaMonto as string | null) ?? "ARS",
            precioTransportistaExterno:
              row.precioTransportistaExterno != null
                ? Number(row.precioTransportistaExterno)
                : null,
            monedaPrecioTransportistaExterno:
              (row.monedaPrecioTransportistaExterno as string | null) ?? "ARS",
            facturaId: facturaClienteId,
            observaciones,
            otrosGastos: this.extractOtrosGastos(row),
            createdBy,
          },
          select: { id: true },
        });

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
          // Usamos tx para la factura externa
          await tx.factura.create({
            data: {
              tenantId,
              numero: row.nroFacturaTransporte as string,
              tipo: "transportista_externo",
              importe:
                row.precioTransportistaExterno != null
                  ? Number(row.precioTransportistaExterno)
                  : 0,
              fechaEmision,
              fechaVencimiento:
                (row.fechaVencimientoFacturaTransp as Date | null) ?? null,
              estado: "pendiente",
            },
          });
        }

        return viaje.id;
      });
    } catch (error) {
      // 3. Limpiamos los errores y los lanzamos nuevamente como Error estándar
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        // Fallo de unicidad (P2002) - Ej: Factura duplicada
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

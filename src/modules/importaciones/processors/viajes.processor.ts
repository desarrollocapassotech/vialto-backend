import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client"; // Importante: necesario para capturar errores específicos
import { PrismaService } from "../../../shared/prisma/prisma.service";
import { generateNumeroViaje } from "../../viajes/generate-viaje-numero";
import { syncLiquidacionEstadoViaje } from "../../viajes/viaje-estado-financiero";
import { assertFechaDescargaValida } from "../../viajes/viajes.service";
import { assertTransportistaEfectivoSubcontratacion } from "../../viajes/viaje-operacion-exclusiva";
import {
  FACTURACION_ESTADOS_DISPONIBLES,
  LIQUIDACION_ESTADOS_DISPONIBLES,
} from "../../viajes/viaje-estados";
import type { IImportProcessor, InsertResult } from "./import-processor.interface";
import type { ValidatedRow } from "../types/import.types";

@Injectable()
export class ViajesProcessor implements IImportProcessor {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * `ValidatedRow` declara `fechaCarga`/`fechaDescarga` como `Date`, pero en
   * `confirm()` la fila viene de `ImportSession.filasValidas` (columna Json)
   * — Prisma serializa los Date a string al guardar y NO los rehidrata al
   * leer, así que en la práctica llegan como string. Normaliza siempre a un
   * Date real antes de usarlas (ej. `assertFechaDescargaValida` llama
   * `.toISOString()` y explota si le llega un string).
   */
  private toDate(value: unknown): Date | null {
    if (value == null) return null;
    if (value instanceof Date) return value;
    const d = new Date(value as string);
    return isNaN(d.getTime()) ? null : d;
  }

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

  /**
   * Vincula (o actualiza la cantidad de) un único producto por viaje —
   * alcance reducido a propósito: el modelo soporta varios productos por
   * viaje, pero el import solo cubre uno. Si la fila no trae Producto, no
   * toca nada (ni en alta ni en reimport).
   */
  private async upsertProductoViaje(
    tx: Prisma.TransactionClient,
    tenantId: string,
    viajeId: string,
    row: ValidatedRow,
  ): Promise<void> {
    if (!row.productoId) return;
    const productoId = row.productoId as string;
    const cantidad =
      row.cantidadProducto != null ? Number(row.cantidadProducto) : undefined;
    await tx.viajeProducto.upsert({
      where: { viajeId_productoId: { viajeId, productoId } },
      create: { tenantId, viajeId, productoId, cantidad: cantidad ?? null },
      update: { cantidad },
    });
  }

  /**
   * Busca un viaje ya importado que corresponda a esta fila. Prioridad:
   * 1) ID Personalizado, si la fila lo trae (match exacto e inequívoco).
   * 2) Si no, la combinación cliente + transporte + origen + destino +
   *    fecha de carga + fecha de descarga — todos obligatorios en el
   *    import, así que siempre están disponibles. No es infalible: dos
   *    viajes reales distintos con esos mismos datos (mismo cliente y
   *    transporte, misma ruta, mismo día) se tratarían como el mismo.
   */
  private async findExisting(
    row: ValidatedRow,
    tenantId: string,
  ): Promise<string | null> {
    const numeroIdentificacionPersonalizado =
      (row.numeroIdentificacionPersonalizado as string | null)
        ?.toString()
        .trim() || null;

    if (numeroIdentificacionPersonalizado) {
      const existing = await this.prisma.viaje.findFirst({
        where: { tenantId, numeroIdentificacionPersonalizado },
        select: { id: true },
      });
      if (existing) return existing.id;
    }

    const existing = await this.prisma.viaje.findFirst({
      where: {
        tenantId,
        clienteId: row.clienteId as string,
        transportistaId: row.transportistaId as string,
        origen: { equals: (row.origen as string).trim(), mode: "insensitive" },
        destino: { equals: (row.destino as string).trim(), mode: "insensitive" },
        fechaCarga: row.fechaCarga as Date,
        fechaDescarga: row.fechaDescarga as Date,
      },
      select: { id: true },
    });
    return existing?.id ?? null;
  }

  async insert(
    row: ValidatedRow,
    tenantId: string,
    createdBy: string,
  ): Promise<InsertResult> {
    try {
      const existingId = await this.findExisting(row, tenantId);
      if (existingId) {
        const id = await this.update(existingId, row, tenantId);
        // update() nunca adjunta una factura nueva — y si el viaje ya
        // estaba facturado, ni siquiera llega hasta acá (corta antes con
        // error). Si llegamos, no está facturado.
        return { id, creado: false, facturado: false };
      }

      const { id, facturado } = await this.create(row, tenantId, createdBy);
      return { id, creado: true, facturado };
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
    // Mismo criterio que el alta manual (ViajesService.update): una vez que
    // el viaje tiene una factura o liquidación vigente, sus datos fiscales
    // quedan protegidos. El import siempre reescribe esos campos de punta a
    // punta (no es un patch parcial), así que si está bloqueado se corta la
    // fila entera en vez de arriesgarse a pisar un comprobante ya emitido.
    const current = await this.prisma.viaje.findUniqueOrThrow({
      where: { id: viajeId },
      select: { facturacionEstado: true, liquidacionEstado: true },
    });
    const bloqueadoPorFactura = !(
      FACTURACION_ESTADOS_DISPONIBLES as readonly string[]
    ).includes(current.facturacionEstado);
    const bloqueadoPorLiquidacion =
      current.liquidacionEstado != null &&
      !(LIQUIDACION_ESTADOS_DISPONIBLES as readonly string[]).includes(
        current.liquidacionEstado,
      );
    if (bloqueadoPorFactura || bloqueadoPorLiquidacion) {
      const motivo =
        bloqueadoPorFactura && bloqueadoPorLiquidacion
          ? "facturado y liquidado"
          : bloqueadoPorFactura
            ? "facturado"
            : "liquidado";
      throw new Error(
        `No se puede reimportar este viaje: ya está ${motivo}. Los datos fiscales quedan protegidos una vez facturado o liquidado — editalo manualmente desde la ficha del viaje si hace falta.`,
      );
    }

    const clienteId = row.clienteId as string;
    const fechaCarga = this.toDate(row.fechaCarga) ?? undefined;
    const fechaDescarga = this.toDate(row.fechaDescarga) ?? undefined;
    if (fechaCarga && fechaDescarga) {
      assertFechaDescargaValida(fechaCarga, fechaDescarga);
    }
    const transportistaEfectivoId =
      (row.transportistaEfectivoId as string | null) ?? undefined;
    if (transportistaEfectivoId) {
      assertTransportistaEfectivoSubcontratacion({
        transportistaId: row.transportistaId as string,
        transportistaEfectivoId,
        contratanteRealizaFlete: false,
      });
    }

    // Campos opcionales: `undefined` (no `null`) cuando la celda viene vacía,
    // para que reimportar el mismo ID Personalizado con un Excel más acotado
    // no borre datos ya cargados que esa fila no trae.
    await this.prisma.$transaction(async (tx) => {
      await tx.viaje.update({
        where: { id: viajeId },
        data: {
          clienteId,
          transportistaId: (row.transportistaId as string | null) ?? undefined,
          transportistaEfectivoId,
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
      await this.upsertProductoViaje(tx, tenantId, viajeId, row);
    });

    return viajeId;
  }

  private async create(
    row: ValidatedRow,
    tenantId: string,
    createdBy: string,
  ): Promise<{ id: string; facturado: boolean }> {
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
      const fechaCarga = this.toDate(row.fechaCarga);
      const fechaDescarga = this.toDate(row.fechaDescarga);

      if (!fechaCarga) throw new Error("La fecha de carga es requerida.");
      if (!fechaDescarga)
        throw new Error("La fecha de descarga es requerida.");
      assertFechaDescargaValida(fechaCarga, fechaDescarga);

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
      const transportistaEfectivoId =
        (row.transportistaEfectivoId as string | null) ?? null;
      if (transportistaEfectivoId) {
        assertTransportistaEfectivoSubcontratacion({
          transportistaId,
          transportistaEfectivoId,
          contratanteRealizaFlete: false,
        });
      }
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
        const numeroFactura = row.nroFactura as string;
        const montoFila = row.monto != null ? Number(row.monto) : 0;

        // Si ya existe una factura con el mismo número para este cliente
        // (de una fila anterior de este mismo import, o de un import
        // previo), no se crea una duplicada: se reutiliza y se le suma el
        // importe de este viaje — el usuario ya confirmó este
        // comportamiento antes de llegar acá (ver ImportacionesService
        // .confirm / detectarFacturasDuplicadas).
        const existente = await tx.factura.findFirst({
          where: { tenantId, tipo: "cliente", numero: numeroFactura, clienteId },
          select: { id: true, importe: true },
        });

        if (existente) {
          await tx.factura.update({
            where: { id: existente.id },
            data: { importe: existente.importe + montoFila },
          });
          facturaClienteId = existente.id;
        } else {
          const fechaEmision =
            (row.fechaEmisionFactura as Date | null) ?? fechaCarga ?? new Date();
          const factura = await tx.factura.create({
            data: {
              tenantId,
              numero: numeroFactura,
              tipo: "cliente",
              clienteId,
              importe: montoFila,
              fechaEmision,
              fechaVencimiento:
                (row.fechaVencimientoFactura as Date | null) ?? null,
              estado: "pendiente",
            },
            select: { id: true },
          });
          facturaClienteId = factura.id;
        }
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
          transportistaEfectivoId,
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

      // `vehiculoId` puede ser un solo id o, con columnas "multiple" (ej.
      // patente de tractor + semirremolque separadas por "/"), un array —
      // se vincula uno por uno, respetando el orden en que vinieron.
      const vehiculoIds = Array.isArray(row.vehiculoId)
        ? row.vehiculoId
        : row.vehiculoId
          ? [row.vehiculoId as string]
          : [];
      for (let i = 0; i < vehiculoIds.length; i++) {
        await tx.viajeVehiculo.create({
          data: {
            tenantId,
            viajeId: viaje.id,
            vehiculoId: vehiculoIds[i],
            orden: i,
          },
        });
      }

      await this.upsertProductoViaje(tx, tenantId, viaje.id, row);

      // El pago al transportista ya no se representa como una Factura
      // tipo "transportista_externo" — ese camino se reemplazó por
      // Liquidaciones (ver ImportacionesPostViajesService). Los campos
      // financieros del flete (precioTransportistaExterno, moneda) quedan
      // en el viaje igual, para que la liquidación borrador los tome.

      return { id: viaje.id, facturado: facturaClienteId != null };
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

  /** Clave normalizada para el fallback compuesto de `findExisting` — misma combinación de campos, para poder comparar en memoria sin una query por fila. */
  private claveCompuesta(
    clienteId: string,
    transportistaId: string,
    origen: string,
    destino: string,
    fechaCarga: Date,
    fechaDescarga: Date,
  ): string {
    return [
      clienteId,
      transportistaId,
      origen.trim().toLowerCase(),
      destino.trim().toLowerCase(),
      fechaCarga.toISOString(),
      fechaDescarga.toISOString(),
    ].join("|");
  }

  /**
   * Versión batcheada de `findExisting`: en vez de una query por fila,
   * resuelve todas las filas con ID Personalizado en una sola consulta, y
   * el resto (fallback compuesto) en otra — mismo criterio de matcheo que
   * `findExisting`, sin N+1. Devuelve, por número de fila (`_rowNum`), el id
   * del viaje YA EXISTENTE que le corresponde (se actualizaría) — las filas
   * que no aparecen acá son altas nuevas.
   */
  private async resolverFilasExistentes(
    rows: ValidatedRow[],
    tenantId: string,
  ): Promise<Map<number, string>> {
    const numerosId = rows
      .map((r) =>
        (r.numeroIdentificacionPersonalizado as string | null)
          ?.toString()
          .trim(),
      )
      .filter((n): n is string => !!n);

    const existentesPorNumero = numerosId.length
      ? await this.prisma.viaje.findMany({
          where: { tenantId, numeroIdentificacionPersonalizado: { in: numerosId } },
          select: { id: true, numeroIdentificacionPersonalizado: true },
        })
      : [];
    const idPorNumero = new Map(
      existentesPorNumero
        .filter((v) => v.numeroIdentificacionPersonalizado)
        .map((v) => [v.numeroIdentificacionPersonalizado as string, v.id]),
    );

    const filasExistentes = new Map<number, string>();
    const pendientes: ValidatedRow[] = [];
    for (const r of rows) {
      const numero = (r.numeroIdentificacionPersonalizado as string | null)
        ?.toString()
        .trim();
      const id = numero ? idPorNumero.get(numero) : undefined;
      if (id) {
        filasExistentes.set(r._rowNum, id);
      } else {
        pendientes.push(r);
      }
    }
    if (pendientes.length === 0) return filasExistentes;

    // Fallback compuesto (cliente + transporte + origen + destino + fechas)
    // para las filas que no matchearon por ID Personalizado — mismos campos
    // que `findExisting`, todos obligatorios en el template de Viajes.
    type FilaCompuesta = {
      row: ValidatedRow;
      clienteId: string;
      transportistaId: string;
      origen: string;
      destino: string;
      fechaCarga: Date;
      fechaDescarga: Date;
    };
    const conDatosCompuestos: FilaCompuesta[] = [];
    for (const r of pendientes) {
      const clienteId = r.clienteId as string | undefined;
      const transportistaId = r.transportistaId as string | undefined;
      const origen = r.origen as string | undefined;
      const destino = r.destino as string | undefined;
      const fechaCarga = this.toDate(r.fechaCarga);
      const fechaDescarga = this.toDate(r.fechaDescarga);
      if (
        clienteId &&
        transportistaId &&
        origen &&
        destino &&
        fechaCarga &&
        fechaDescarga
      ) {
        conDatosCompuestos.push({
          row: r,
          clienteId,
          transportistaId,
          origen,
          destino,
          fechaCarga,
          fechaDescarga,
        });
      }
    }
    if (conDatosCompuestos.length === 0) return filasExistentes;

    const existentesCompuesto = await this.prisma.viaje.findMany({
      where: {
        OR: conDatosCompuestos.map((f) => ({
          tenantId,
          clienteId: f.clienteId,
          transportistaId: f.transportistaId,
          origen: { equals: f.origen.trim(), mode: "insensitive" as const },
          destino: { equals: f.destino.trim(), mode: "insensitive" as const },
          fechaCarga: f.fechaCarga,
          fechaDescarga: f.fechaDescarga,
        })),
      },
      select: {
        id: true,
        clienteId: true,
        transportistaId: true,
        origen: true,
        destino: true,
        fechaCarga: true,
        fechaDescarga: true,
      },
    });
    const idPorClave = new Map(
      existentesCompuesto.map((v) => [
        this.claveCompuesta(
          v.clienteId,
          v.transportistaId,
          v.origen,
          v.destino,
          v.fechaCarga,
          v.fechaDescarga,
        ),
        v.id,
      ]),
    );

    for (const f of conDatosCompuestos) {
      const clave = this.claveCompuesta(
        f.clienteId,
        f.transportistaId,
        f.origen,
        f.destino,
        f.fechaCarga,
        f.fechaDescarga,
      );
      const id = idPorClave.get(clave);
      if (id) filasExistentes.set(f.row._rowNum, id);
    }

    return filasExistentes;
  }

  async contarExistentes(rows: ValidatedRow[], tenantId: string): Promise<number> {
    const filasExistentes = await this.resolverFilasExistentes(rows, tenantId);
    return filasExistentes.size;
  }

  /**
   * Detecta números de factura que van a terminar compartidos por más de
   * un viaje NUEVO de este archivo (o que ya existen como Factura de otro
   * import) — en esos casos `insert()` reutiliza la factura existente y le
   * suma el importe en vez de crear un duplicado, así que el usuario tiene
   * que confirmarlo antes de poder importar (ver `ConfirmImportDto.
   * confirmarFacturasDuplicadas`). Solo mira filas que van a ser altas
   * nuevas — una fila que actualiza un viaje existente no toca su factura.
   */
  async detectarFacturasDuplicadas(
    rows: ValidatedRow[],
    tenantId: string,
  ): Promise<{ numero: string; filas: number[] }[]> {
    const filasExistentes = await this.resolverFilasExistentes(rows, tenantId);
    const nuevas = rows.filter((r) => !filasExistentes.has(r._rowNum));

    const porClave = new Map<
      string,
      { numero: string; clienteId: string; filas: number[] }
    >();
    for (const r of nuevas) {
      const numero = (r.nroFactura as string | null)?.toString().trim();
      const clienteId = r.clienteId as string | undefined;
      if (!numero || !clienteId) continue;
      const clave = `${clienteId}::${numero.toLowerCase()}`;
      const grupo = porClave.get(clave);
      if (grupo) {
        grupo.filas.push(r._rowNum);
      } else {
        porClave.set(clave, { numero, clienteId, filas: [r._rowNum] });
      }
    }
    if (porClave.size === 0) return [];

    const numerosUnicos = [...new Set([...porClave.values()].map((g) => g.numero))];
    const existentesEnBd = await this.prisma.factura.findMany({
      where: { tenantId, tipo: "cliente", numero: { in: numerosUnicos } },
      select: { numero: true, clienteId: true },
    });
    const clavesEnBd = new Set(
      existentesEnBd
        .filter((f) => f.clienteId)
        .map((f) => `${f.clienteId}::${(f.numero as string).toLowerCase()}`),
    );

    const resultado: { numero: string; filas: number[] }[] = [];
    for (const [clave, grupo] of porClave) {
      if (grupo.filas.length > 1 || clavesEnBd.has(clave)) {
        resultado.push({ numero: grupo.numero, filas: grupo.filas });
      }
    }
    return resultado;
  }

  /**
   * Estado actual (antes de este import) de los viajes que ya existen entre
   * `rows` — para que el preview pueda mostrar un antes/después por campo
   * en vez de solo los valores nuevos. Los nombres/patentes ya vienen
   * resueltos a texto (no ids), igual que se muestran en el preview.
   */
  async obtenerEstadoActual(
    rows: ValidatedRow[],
    tenantId: string,
  ): Promise<Map<number, ViajeActual>> {
    const filasExistentes = await this.resolverFilasExistentes(rows, tenantId);
    if (filasExistentes.size === 0) return new Map();

    const ids = [...new Set(filasExistentes.values())];
    const viajes = await this.prisma.viaje.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        cliente: { select: { nombre: true } },
        transportista: { select: { nombre: true } },
        chofer: { select: { nombre: true } },
        vehiculosViaje: {
          select: { vehiculo: { select: { patente: true } } },
          orderBy: { orden: "asc" },
        },
        origen: true,
        destino: true,
        fechaCarga: true,
        fechaDescarga: true,
        detalleCarga: true,
        monto: true,
        monedaMonto: true,
        nroFactura: true,
        precioTransportistaExterno: true,
        monedaPrecioTransportistaExterno: true,
      },
    });

    const porId = new Map<string, ViajeActual>(
      viajes.map((v) => {
        const patentes = v.vehiculosViaje
          .map((vv) => vv.vehiculo.patente)
          .filter((p): p is string => !!p);
        return [
          v.id,
          {
            cliente: v.cliente?.nombre ?? null,
            transporte: v.transportista?.nombre ?? null,
            chofer: v.chofer?.nombre ?? null,
            vehiculo: patentes.length > 0 ? patentes.join("/") : null,
            origen: v.origen,
            destino: v.destino,
            fechaCarga: v.fechaCarga,
            fechaDescarga: v.fechaDescarga,
            detalleCarga: v.detalleCarga,
            monto: v.monto,
            monedaMonto: v.monedaMonto,
            nroFactura: v.nroFactura,
            precioTransportistaExterno: v.precioTransportistaExterno,
            monedaPrecioTransportistaExterno: v.monedaPrecioTransportistaExterno,
          },
        ];
      }),
    );

    const resultado = new Map<number, ViajeActual>();
    for (const [fila, viajeId] of filasExistentes) {
      const actual = porId.get(viajeId);
      if (actual) resultado.set(fila, actual);
    }
    return resultado;
  }
}

export interface ViajeActual {
  cliente: string | null;
  transporte: string | null;
  chofer: string | null;
  /** Patentes ya unidas con "/" si el viaje tiene más de un vehículo vinculado. */
  vehiculo: string | null;
  origen: string | null;
  destino: string | null;
  fechaCarga: Date | null;
  fechaDescarga: Date | null;
  detalleCarga: string | null;
  monto: number | null;
  monedaMonto: string | null;
  nroFactura: string | null;
  precioTransportistaExterno: number | null;
  monedaPrecioTransportistaExterno: string | null;
}

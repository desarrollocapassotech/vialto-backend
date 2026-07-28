import { IsNotEmpty, IsObject, IsString } from "class-validator";

/**
 * DTO para que la app vialto-combustible reporte un error al sincronizar una
 * carga guardada offline (COMB-07-T4). `payload` no se tipa campo por campo
 * a propósito: es un log (igual criterio que ArcaLog.requestBody /
 * ImportLog.detalles), no una escritura de negocio — se guarda tal cual para
 * que el administrador vea qué se intentó cargar.
 */
export class LogSyncErrorDto {
  @IsString() @IsNotEmpty() mensaje: string;
  @IsObject() payload: Record<string, unknown>;
}

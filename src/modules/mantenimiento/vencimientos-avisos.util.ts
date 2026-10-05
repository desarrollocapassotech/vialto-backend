import type { NotificacionItem } from '../notificaciones/evaluators/notificacion-evaluator.interface';
import type { FilaVencimiento } from './vencimientos.util';

const FUENTE_KM: Record<string, string> = {
  carga: 'carga de combustible',
  edicion: 'corrección manual',
  orden_trabajo: 'orden de trabajo',
  vehiculo: 'km de la unidad',
};

const fmtKm = (km: number) => km.toLocaleString('es-AR');
const fmtFecha = (d: Date) =>
  d.toLocaleDateString('es-AR', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' });
const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

function kmActual(f: FilaVencimiento): string {
  if (!f.odometro) return '';
  // El respaldo `vehiculo` no tiene fecha de lectura real (es la del alta de la unidad): no se muestra.
  if (f.odometro.fuente === 'vehiculo') return ` Km actual: ${fmtKm(f.odometro.km)} (cargado en la unidad).`;
  const fuente = FUENTE_KM[f.odometro.fuente] ?? f.odometro.fuente;
  return ` Km actual: ${fmtKm(f.odometro.km)} (${fuente} del ${fmtFecha(f.odometro.fecha)}).`;
}

function detalle(f: FilaVencimiento): string {
  if (f.motivo === 'km' && f.kmRestantes !== null && f.proximoKm !== null) {
    if (f.estado === 'vencido') {
      return `Pasado por ${fmtKm(-f.kmRestantes)} km (tocaba a los ${fmtKm(f.proximoKm)} km).${kmActual(f)}`;
    }
    const estimado = f.fechaEstimada ? `; estimado ${fmtFecha(f.fechaEstimada)}` : '';
    return `Faltan ${fmtKm(f.kmRestantes)} km (próximo service a los ${fmtKm(f.proximoKm)} km${estimado}).${kmActual(f)}`;
  }
  if (f.motivo === 'fecha' && f.proximaFecha && f.diasRestantes !== null) {
    if (f.estado === 'vencido') {
      const hace = -f.diasRestantes;
      return `Venció el ${fmtFecha(f.proximaFecha)}${hace > 0 ? ` (hace ${plural(hace, 'día', 'días')})` : ' (hoy)'}.`;
    }
    return `Faltan ${plural(f.diasRestantes, 'día', 'días')} (vence el ${fmtFecha(f.proximaFecha)}).`;
  }
  return f.estado === 'vencido' ? 'Venció.' : 'Está por vencer.';
}

/**
 * Avisos de un estado (próximo o vencido) a partir de las filas del semáforo.
 * `entidadId = vehiculoPlanId:referencia.id` → se avisa una vez por ciclo y por estado: al
 * registrar el service siguiente cambia la referencia y se vuelve a avisar en el ciclo nuevo.
 */
export function armarAvisosVencimiento(
  filas: FilaVencimiento[],
  estado: 'proximo' | 'vencido',
): NotificacionItem[] {
  return filas
    .filter((f) => f.estado === estado && f.referencia)
    .map((f) => ({
      entidadId: `${f.vehiculoPlanId}:${f.referencia!.id}`,
      titulo: `${f.vehiculo.patente} — ${f.plan.nombre}`,
      detalle: detalle(f),
    }));
}

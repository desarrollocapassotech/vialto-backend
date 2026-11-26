/**
 * Manda un email de prueba por cada tipo de notificación del catálogo, con datos de ejemplo
 * (no lee la base: ningún dato real de una empresa sale en el mail). Asunto con "[PRUEBA]".
 * Usa el mismo template y el mismo ResendEmailService que el cron (RESEND_API_KEY del .env).
 *
 * Uso: npm run prueba:emails-notificacion -- destino@dominio.com [tipo]
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { armarEmailNotificacion } from '../src/modules/notificaciones/notificacion-email.template';
import { armarAvisosVencimientos } from '../src/modules/notificaciones/evaluators/vencimientos.evaluator';
import { NOTIFICACIONES_CATALOG, urlDestinoDe } from '../src/modules/notificaciones/notificaciones-catalog';
import { fechaCalendarioAr } from '../src/shared/util/fecha-ar.util';
import { ResendEmailService } from '../src/shared/email/resend-email.service';
import type { NotificacionItem } from '../src/modules/notificaciones/evaluators/notificacion-evaluator.interface';

// .env sin depender del paquete dotenv.
const envPath = resolve('.env');
if (existsSync(envPath)) {
  for (const linea of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const destino = process.argv[2];
const soloTipo = process.argv[3];
if (!destino || !destino.includes('@')) {
  console.error('Uso: npm run prueba:emails-notificacion -- destino@dominio.com [tipo]');
  process.exit(1);
}

const hoy = fechaCalendarioAr();
const dia = (n: number) => new Date(hoy.getTime() + n * 86_400_000);
const fmt = (d: Date) => d.toLocaleDateString('es-AR', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' });

const EJEMPLOS: Record<string, NotificacionItem[]> = {
  vencimientos: armarAvisosVencimientos(
    [
      { id: 'm1', contraparte: 'Distribuidora del Litoral', sentido: 'cobrar', comprobante: 'FACTURA A 0003-00000094', fechaVencimiento: dia(-4), saldo: 1_850_000, moneda: 'ARS', url: '/cuenta-corriente?tipo=cliente' },
      { id: 'm2', contraparte: 'Transportes del Sur', sentido: 'pagar', comprobante: 'LIQUIDO PRODUCTO A 0003-00000412', fechaVencimiento: dia(-1), saldo: 920_500, moneda: 'ARS', url: '/cuenta-corriente?tipo=proveedor' },
      { id: 'm3', contraparte: 'Agroexport SA', sentido: 'cobrar', comprobante: 'FACTURA E 0005-00000017', fechaVencimiento: dia(0), saldo: 12_400, moneda: 'USD', url: '/cuenta-corriente?tipo=cliente' },
      { id: 'm4', contraparte: 'Molinos Pampeanos', sentido: 'cobrar', comprobante: 'FACTURA A 0003-00000101', fechaVencimiento: dia(1), saldo: 640_000, moneda: 'ARS', url: '/cuenta-corriente?tipo=cliente' },
      { id: 'm5', contraparte: 'Taller Ruta 9', sentido: 'pagar', comprobante: 'COMPRA 0002-00004587', fechaVencimiento: dia(3), saldo: 215_300, moneda: 'ARS', url: '/cuenta-corriente?tipo=proveedor' },
    ],
    hoy,
  ),
  'combustible.cargaSospechosa': [
    { entidadId: 'k1', titulo: 'Revisá la carga de AB123CD en YPF Ruta 9', detalle: '', subtitulo: `${fmt(dia(-2))} · 1.250 litros`, etiqueta: 'Los litros parecen demasiados o muy pocos', tono: 'aviso', url: '/combustible', importe: { monto: 1_312_500, moneda: 'ARS' } },
    { entidadId: 'k2', titulo: 'Revisá la carga de AE456FG en Shell Rosario', detalle: '', subtitulo: `${fmt(dia(-3))} · 310 litros`, etiqueta: 'El kilometraje no coincide con las cargas anteriores', tono: 'aviso', url: '/combustible', importe: { monto: 325_500, moneda: 'ARS' } },
    { entidadId: 'k3', titulo: 'Revisá la carga de AC789HJ en Axion Pergamino', detalle: '', subtitulo: `${fmt(dia(-4))} · 180 litros`, etiqueta: 'El precio por litro no es el habitual', tono: 'aviso', url: '/combustible', importe: { monto: 412_000, moneda: 'ARS' } },
  ],
  'combustible.errorChofer': [
    { entidadId: 'e1', titulo: 'Carga de Juan Pérez no se pudo registrar', detalle: 'AB123CD · carga del ' + fmt(hoy) + ' · Tocá para ver qué pasó y cómo resolverlo', subtitulo: `AB123CD · carga del ${fmt(hoy)}`, tono: 'alerta', url: '/?combustibleTab=alertas' },
  ],
  'liquidaciones.pendienteAnulacion': [
    { entidadId: 'l1', titulo: 'Liquidación 00003-00000125 · Transportes del Sur', detalle: '', etiqueta: `Desde el ${fmt(dia(-9))}`, tono: 'aviso', url: '/liquidaciones?estado=pendiente_anulacion', importe: { monto: 1_540_200.5, moneda: 'ARS' } },
    { entidadId: 'l2', titulo: 'Liquidación 00003-00000131 · Fletes Rafaela', detalle: '', etiqueta: `Desde el ${fmt(dia(-2))}`, tono: 'aviso', url: '/liquidaciones?estado=pendiente_anulacion', importe: { monto: 860_000, moneda: 'ARS' } },
  ],
  'mantenimiento.vencimientoProximo': [
    { entidadId: 'p1', titulo: 'AB123CD · Service 20.000 km', detalle: 'Faltan 850 km (próximo service a los 120.000 km; estimado ' + fmt(dia(6)) + '). Km actual: 119.150 (carga de combustible del ' + fmt(dia(-1)) + ').', tono: 'aviso', url: '/mantenimiento' },
    { entidadId: 'p2', titulo: 'AE456FG · VTV', detalle: `Faltan 12 días (vence el ${fmt(dia(12))}).`, tono: 'aviso', url: '/mantenimiento' },
  ],
  'mantenimiento.vencido': [
    { entidadId: 'v1', titulo: 'AC789HJ · Cambio de cubiertas', detalle: 'Pasado por 2.300 km (tocaba a los 80.000 km). Km actual: 82.300 (orden de trabajo del ' + fmt(dia(-5)) + ').', tono: 'alerta', url: '/mantenimiento' },
  ],
};

(async () => {
  const email = new ResendEmailService();
  const tipos = NOTIFICACIONES_CATALOG.filter((c) => !soloTipo || c.tipo === soloTipo);
  const todosLosModulos = [...new Set(NOTIFICACIONES_CATALOG.flatMap((c) => [c.requiereModulo].flat()))];
  let fallos = 0;

  for (const c of tipos) {
    const items = EJEMPLOS[c.tipo];
    if (!items) {
      console.warn(`- ${c.tipo}: sin datos de ejemplo, se saltea`);
      continue;
    }
    const contenido = armarEmailNotificacion({
      label: c.label,
      intro: c.introEmail,
      empresa: 'Empresa de ejemplo',
      frecuencia: c.frecuencia,
      items,
      rutaBoton: urlDestinoDe(c, todosLosModulos),
    });
    const ok = await email.send({ to: [destino], ...contenido, subject: `[PRUEBA] ${contenido.subject}` });
    console.log(`${ok ? '✓' : '✗'} ${c.tipo}: ${contenido.subject}`);
    if (!ok) fallos++;
    await new Promise((r) => setTimeout(r, 600)); // Resend: 2 envíos por segundo en el plan base
  }
  if (fallos > 0) process.exit(1);
})();

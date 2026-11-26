/**
 * Vista previa del email de notificaciones con datos de ejemplo (no lee la base ni envía nada).
 * Uso: npm run preview:email-notificacion -- [carpeta de salida]   (default: ./tmp-email-preview)
 * Genera un .html por tipo de aviso para abrir en el navegador.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { armarEmailNotificacion } from '../src/modules/notificaciones/notificacion-email.template';
import { armarAvisosVencimientos } from '../src/modules/notificaciones/evaluators/vencimientos.evaluator';
import { NOTIFICACIONES_CATALOG } from '../src/modules/notificaciones/notificaciones-catalog';
import { fechaCalendarioAr } from '../src/shared/util/fecha-ar.util';
import type { NotificacionItem } from '../src/modules/notificaciones/evaluators/notificacion-evaluator.interface';

const salida = resolve(process.argv[2] ?? 'tmp-email-preview');
mkdirSync(salida, { recursive: true });

const hoy = fechaCalendarioAr();
const dia = (n: number) => new Date(hoy.getTime() + n * 86_400_000);
const cat = (tipo: string) => NOTIFICACIONES_CATALOG.find((c) => c.tipo === tipo)!;

const vencimientos = armarAvisosVencimientos(
  [
    { id: 'm1', contraparte: 'Distribuidora del Litoral', sentido: 'cobrar', comprobante: 'FACTURA A 0003-00000094', fechaVencimiento: dia(-4), saldo: 1_850_000, moneda: 'ARS', url: '/cuenta-corriente?tipo=cliente&id=c1' },
    { id: 'm2', contraparte: 'Transportes del Sur', sentido: 'pagar', comprobante: 'LIQUIDO PRODUCTO A 0003-00000412', fechaVencimiento: dia(-1), saldo: 920_500, moneda: 'ARS', url: '/cuenta-corriente?tipo=proveedor&id=p1' },
    { id: 'm3', contraparte: 'Agroexport SA', sentido: 'cobrar', comprobante: 'FACTURA E 0005-00000017', fechaVencimiento: dia(0), saldo: 12_400, moneda: 'USD', url: '/cuenta-corriente?tipo=cliente&id=c2' },
    { id: 'm4', contraparte: 'Molinos Pampeanos', sentido: 'cobrar', comprobante: 'FACTURA A 0003-00000101', fechaVencimiento: dia(1), saldo: 640_000, moneda: 'ARS', url: '/cuenta-corriente?tipo=cliente&id=c3' },
    { id: 'm5', contraparte: 'Taller Ruta 9', sentido: 'pagar', comprobante: 'COMPRA 0002-00004587', fechaVencimiento: dia(3), saldo: 215_300, moneda: 'ARS', url: '/cuenta-corriente?tipo=proveedor&id=p2' },
  ],
  hoy,
);

const cargas: NotificacionItem[] = [
  { entidadId: 'k1', titulo: 'Revisá la carga de AB123CD en YPF Ruta 9', detalle: '', subtitulo: '24/11/2026 · 1.250 litros', etiqueta: 'Los litros parecen demasiados o muy pocos', tono: 'aviso', url: '/combustible?carga=k1', importe: { monto: 1_312_500, moneda: 'ARS' } },
  { entidadId: 'k2', titulo: 'Revisá la carga de AE456FG en Shell Rosario', detalle: '', subtitulo: '23/11/2026 · 310 litros', etiqueta: 'El kilometraje no coincide con las cargas anteriores', tono: 'aviso', url: '/combustible?carga=k2', importe: { monto: 325_500, moneda: 'ARS' } },
];

const ejemplos: { archivo: string; tipo: string; items: NotificacionItem[]; ruta: string }[] = [
  { archivo: 'vencimientos.html', tipo: 'vencimientos', items: vencimientos, ruta: '/cuenta-corriente' },
  { archivo: 'cargas-para-revisar.html', tipo: 'combustible.cargaSospechosa', items: cargas, ruta: '/?combustibleTab=alertas' },
];

for (const ej of ejemplos) {
  const c = cat(ej.tipo);
  const email = armarEmailNotificacion({
    label: c.label,
    intro: c.introEmail,
    empresa: 'Empresa de ejemplo',
    frecuencia: c.frecuencia,
    items: ej.items,
    rutaBoton: ej.ruta,
  });
  writeFileSync(join(salida, ej.archivo), email.html, 'utf8');
  writeFileSync(join(salida, ej.archivo.replace('.html', '.txt')), `${email.subject}\n\n${email.text}`, 'utf8');
  console.log(`✓ ${join(salida, ej.archivo)}  —  Asunto: ${email.subject}`);
}

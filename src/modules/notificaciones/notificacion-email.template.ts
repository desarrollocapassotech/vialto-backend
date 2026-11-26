import type { NotificacionFrecuencia } from './notificaciones-catalog';
import type { NotificacionItem, NotificacionTono } from './evaluators/notificacion-evaluator.interface';

/**
 * Email de notificaciones (rediseño nov 2026). Funciones puras: no leen la base ni envían nada,
 * así se pueden previsualizar (`npm run preview:email-notificacion`) y probar sin Resend.
 *
 * Reglas de un email que se ve bien en Gmail/Outlook/Apple Mail: todo con tablas y estilos inline,
 * sin imágenes de fondo ni flexbox, y el `<style>` del head solo para ajustes de mobile (los clientes
 * que lo ignoran ven la versión de escritorio, que también funciona en una pantalla angosta).
 */

/** Logo servido desde el sitio en producción (URL pública estable) — un cliente de email no puede resolver rutas relativas ni localhost. */
const LOGO_URL = 'https://admin.vialto.uno/vialto-software-white-removebg.png';
export const APP_URL = 'https://admin.vialto.uno';

/** Tope de tarjetas por email: un tipo con cientos de avisos (cargas sospechosas) no arma un mail interminable. */
export const MAX_TARJETAS = 20;

/** Colores de marca (`--color-vialto-*` de `index.css` del frontend). Esquinas rectas, como la app. */
const C = {
  charcoal: '#1a1a1a',
  fire: '#e8470a',
  steel: '#4a4a4a',
  mist: '#f5f3f0',
  borde: '#e7e3dc',
  suave: '#8a8580',
};

const TONOS: Record<NotificacionTono, { acento: string; chipFondo: string; chipTexto: string }> = {
  alerta: { acento: '#c62828', chipFondo: '#fdecea', chipTexto: '#b71c1c' },
  aviso: { acento: '#d97706', chipFondo: '#fff4e0', chipTexto: '#92400e' },
  info: { acento: C.steel, chipFondo: '#f1efec', chipTexto: C.steel },
};

const FONT = `font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;`;

/**
 * URL absoluta de una ruta de la app. El frontend usa `HashRouter`: sin el `#` el servidor
 * devuelve "Not Found" (pasaba con el botón de los emails viejos).
 */
export function urlApp(ruta = '/'): string {
  const r = ruta.startsWith('/') ? ruta : `/${ruta}`;
  return `${APP_URL}/#${r}`;
}

export type EmailNotificacionInput = {
  label: string;
  /** Una línea debajo del título que explica qué es el aviso. */
  intro?: string;
  empresa?: string | null;
  frecuencia: NotificacionFrecuencia;
  items: NotificacionItem[];
  /** Ruta de la app (sin `#`) del botón principal. */
  rutaBoton: string;
  /** Fecha del envío (para el encabezado). Default: ahora. */
  fecha?: Date;
};

export type EmailNotificacion = { subject: string; html: string; text: string };

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtMonto(monto: number, moneda: string): string {
  return `${moneda} ${monto.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

type Seccion = { nombre: string | null; tono: NotificacionTono; items: NotificacionItem[] };

/** Agrupa por `seccion` respetando el orden de llegada. El tono de la sección es el del primer ítem. */
function agruparSecciones(items: NotificacionItem[]): Seccion[] {
  const secciones: Seccion[] = [];
  for (const it of items) {
    const nombre = it.seccion ?? null;
    let s = secciones.find((x) => x.nombre === nombre);
    if (!s) {
      s = { nombre, tono: it.tono ?? 'info', items: [] };
      secciones.push(s);
    }
    s.items.push(it);
  }
  return secciones;
}

/** Totales por sentido y moneda (nunca se suman monedas distintas). */
function totales(items: NotificacionItem[]): { sentido: 'cobrar' | 'pagar'; montos: { moneda: string; monto: number }[] }[] {
  const res: { sentido: 'cobrar' | 'pagar'; montos: { moneda: string; monto: number }[] }[] = [];
  for (const sentido of ['cobrar', 'pagar'] as const) {
    const porMoneda = new Map<string, number>();
    for (const it of items) {
      if (it.importe?.sentido !== sentido) continue;
      porMoneda.set(it.importe.moneda, (porMoneda.get(it.importe.moneda) ?? 0) + it.importe.monto);
    }
    if (porMoneda.size === 0) continue;
    res.push({
      sentido,
      montos: [...porMoneda.entries()]
        .sort(([a], [b]) => (a === 'ARS' ? -1 : b === 'ARS' ? 1 : a.localeCompare(b)))
        .map(([moneda, monto]) => ({ moneda, monto: Math.round(monto * 100) / 100 })),
    });
  }
  return res;
}

/** Singular de los nombres de sección conocidos, para "1 vencido" en vez de "1 vencidos". */
const SECCION_SINGULAR: Record<string, string> = {
  Vencidos: 'vencido',
  'Vencen pronto': 'vence pronto',
};

/** "2 vencidos, 1 vence pronto" o "5 avisos nuevos" (asunto, preheader y versión de texto). */
function resumenCorto(secciones: Seccion[], total: number): string {
  const conNombre = secciones.filter((s) => s.nombre);
  if (conNombre.length > 0) {
    return conNombre
      .map((s) => {
        const n = s.items.length;
        const nombre = n === 1 ? (SECCION_SINGULAR[s.nombre!] ?? s.nombre!.toLowerCase()) : s.nombre!.toLowerCase();
        return `${n} ${nombre}`;
      })
      .join(', ');
  }
  return total === 1 ? '1 aviso nuevo' : `${total} avisos nuevos`;
}

const ENCABEZADO_FRECUENCIA: Record<NotificacionFrecuencia, string> = {
  diaria: 'Resumen diario',
  semanal: 'Resumen semanal',
  inmediata: 'Aviso',
};

function fechaLarga(d: Date): string {
  const s = d.toLocaleDateString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function tarjeta(it: NotificacionItem): string {
  const tono = TONOS[it.tono ?? 'info'];
  const href = it.url ? esc(urlApp(it.url)) : null;
  const titulo = href
    ? `<a href="${href}" style="color:${C.charcoal}; text-decoration:none;">${esc(it.titulo)}</a>`
    : esc(it.titulo);
  // Con datos estructurados, el `detalle` (texto de la campana) sería repetido: se muestra solo como respaldo.
  const segunda = it.subtitulo ?? (it.etiqueta ? null : it.detalle);
  const importe = it.importe
    ? `<td class="monto" align="right" valign="top" style="${FONT} padding-left:12px; white-space:nowrap; font-size:15px; font-weight:700; color:${C.charcoal};">${esc(fmtMonto(it.importe.monto, it.importe.moneda))}</td>`
    : '';
  const chip = it.etiqueta
    ? `<span style="display:inline-block; ${FONT} font-size:12px; font-weight:700; line-height:1; padding:5px 8px; background-color:${tono.chipFondo}; color:${tono.chipTexto};">${esc(it.etiqueta)}</span>`
    : '';
  const ver = href
    ? `<a href="${href}" style="${FONT} font-size:13px; font-weight:700; color:${C.fire}; text-decoration:none; white-space:nowrap;">Ver&nbsp;&rarr;</a>`
    : '';
  const filaInferior =
    chip || ver
      ? `<tr>
          <td colspan="2" style="padding-top:10px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
              <td valign="middle">${chip}</td>
              <td valign="middle" align="right">${ver}</td>
            </tr></table>
          </td>
        </tr>`
      : '';

  return `
    <tr><td style="padding-bottom:10px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#ffffff; border:1px solid ${C.borde}; border-left:4px solid ${tono.acento};">
        <tr><td style="padding:14px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td valign="top" style="${FONT} font-size:15px; font-weight:700; line-height:1.35; color:${C.charcoal};">${titulo}</td>
              ${importe}
            </tr>
            ${segunda ? `<tr><td colspan="2" style="${FONT} padding-top:4px; font-size:13px; line-height:1.45; color:${C.steel};">${esc(segunda)}</td></tr>` : ''}
            ${filaInferior}
          </table>
        </td></tr>
      </table>
    </td></tr>`;
}

function bloqueResumen(secciones: Seccion[], tots: ReturnType<typeof totales>): string {
  const conNombre = secciones.filter((s) => s.nombre);
  if (conNombre.length === 0 && tots.length === 0) return '';

  const ancho = conNombre.length > 0 ? Math.floor(100 / conNombre.length) : 100;
  const tiles = conNombre
    .map((s, i) => {
      const t = TONOS[s.tono];
      return `<td class="tile" width="${ancho}%" valign="top" style="padding:${i === 0 ? '0' : '0 0 0 8px'};">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${C.mist}; border-top:3px solid ${t.acento};">
          <tr><td style="padding:12px 14px;">
            <div style="${FONT} font-size:28px; font-weight:800; line-height:1; color:${t.acento};">${s.items.length}</div>
            <div style="${FONT} padding-top:6px; font-size:11px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:${C.steel};">${esc(s.nombre!)}</div>
          </td></tr>
        </table>
      </td>`;
    })
    .join('');

  const filasTotales = tots
    .map(
      (t) => `<tr>
        <td style="${FONT} padding:6px 0; font-size:13px; color:${C.steel}; border-top:1px solid ${C.borde};">${t.sentido === 'cobrar' ? 'Total a cobrar' : 'Total a pagar'}</td>
        <td align="right" style="${FONT} padding:6px 0; font-size:14px; font-weight:700; color:${t.sentido === 'cobrar' ? '#1b7a3d' : C.charcoal}; border-top:1px solid ${C.borde};">${t.montos.map((m) => esc(fmtMonto(m.monto, m.moneda))).join('<br />')}</td>
      </tr>`,
    )
    .join('');

  return `
    ${tiles ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:${filasTotales ? '12px' : '24px'};"><tr>${tiles}</tr></table>` : ''}
    ${filasTotales ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px; border-bottom:1px solid ${C.borde};">${filasTotales}</table>` : ''}`;
}

function encabezadoSeccion(s: Seccion): string {
  if (!s.nombre) return '';
  const t = TONOS[s.tono];
  return `<tr><td style="padding:8px 0 10px;">
    <span style="display:inline-block; width:8px; height:8px; background-color:${t.acento}; vertical-align:middle;"></span>
    <span style="${FONT} padding-left:6px; font-size:12px; font-weight:800; letter-spacing:0.1em; text-transform:uppercase; color:${C.charcoal}; vertical-align:middle;">${esc(s.nombre)}</span>
    <span style="${FONT} padding-left:4px; font-size:12px; color:${C.suave}; vertical-align:middle;">(${s.items.length})</span>
  </td></tr>`;
}

export function armarEmailNotificacion(input: EmailNotificacionInput): EmailNotificacion {
  const { label, intro, empresa, frecuencia, items, rutaBoton } = input;
  const fecha = input.fecha ?? new Date();
  const secciones = agruparSecciones(items);
  const tots = totales(items);
  const resumen = resumenCorto(secciones, items.length);
  const urlBoton = urlApp(rutaBoton);
  const urlConfig = urlApp('/configuracion/notificaciones');

  // Tope de tarjetas repartido en orden (las primeras secciones —vencidos— tienen prioridad).
  let restantes = MAX_TARJETAS;
  const cuerpo = secciones
    .map((s) => {
      const visibles = s.items.slice(0, Math.max(restantes, 0));
      restantes -= visibles.length;
      if (visibles.length === 0) return '';
      return encabezadoSeccion(s) + visibles.map(tarjeta).join('');
    })
    .join('');
  const ocultos = items.length - Math.min(items.length, MAX_TARJETAS);

  const subject = `${label} — ${resumen}${empresa ? ` · ${empresa}` : ''}`;
  const preheader = [resumen, ...tots.map((t) => `${t.sentido === 'cobrar' ? 'A cobrar' : 'A pagar'} ${t.montos.map((m) => fmtMonto(m.monto, m.moneda)).join(' + ')}`)].join(' · ');

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light only" />
<meta name="supported-color-schemes" content="light" />
<title>${esc(label)}</title>
<style>
  @media (max-width: 520px) {
    .px { padding-left: 18px !important; padding-right: 18px !important; }
    .h1 { font-size: 21px !important; }
    .tile { display: block !important; width: 100% !important; padding: 0 0 8px 0 !important; }
    .monto { display: block !important; text-align: left !important; padding: 4px 0 0 0 !important; }
    .btn a { display: block !important; }
  }
</style>
</head>
<body style="margin:0; padding:0; background-color:${C.mist};">
<div style="display:none; max-height:0; overflow:hidden; opacity:0; color:transparent;">${esc(preheader)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${C.mist};">
  <tr><td align="center" style="padding:28px 12px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;">

      <tr><td class="px" style="background-color:${C.charcoal}; padding:18px 28px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td valign="middle"><img src="${LOGO_URL}" alt="Vialto Software" width="120" style="display:block; height:auto; border:0;" /></td>
          <td valign="middle" align="right" style="${FONT} font-size:12px; line-height:1.4; color:#cfcac3;">
            <strong style="color:#ffffff;">${ENCABEZADO_FRECUENCIA[frecuencia]}</strong><br />${esc(fechaLarga(fecha))}
          </td>
        </tr></table>
      </td></tr>
      <tr><td style="height:4px; line-height:4px; font-size:0; background-color:${C.fire};">&nbsp;</td></tr>

      <tr><td class="px" style="background-color:#ffffff; padding:28px 28px 8px;">
        ${empresa ? `<p style="${FONT} margin:0 0 6px; font-size:11px; font-weight:800; letter-spacing:0.14em; text-transform:uppercase; color:${C.fire};">${esc(empresa)}</p>` : ''}
        <h1 class="h1" style="${FONT} margin:0 0 8px; font-size:24px; line-height:1.25; font-weight:800; color:${C.charcoal};">${esc(label)}</h1>
        ${intro ? `<p style="${FONT} margin:0 0 22px; font-size:14px; line-height:1.5; color:${C.steel};">${esc(intro)}</p>` : '<div style="height:14px;"></div>'}
        ${bloqueResumen(secciones, tots)}
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          ${cuerpo}
        </table>
        ${
          ocultos > 0
            ? `<p style="${FONT} margin:4px 0 0; font-size:13px; color:${C.steel};">Y ${ocultos} ${ocultos === 1 ? 'aviso más' : 'avisos más'}. <a href="${esc(urlBoton)}" style="color:${C.fire}; font-weight:700; text-decoration:none;">Ver todos&nbsp;&rarr;</a></p>`
            : ''
        }
      </td></tr>

      <tr><td class="px" style="background-color:#ffffff; padding:18px 28px 30px;">
        <table role="presentation" cellpadding="0" cellspacing="0" class="btn"><tr>
          <td style="background-color:${C.fire};">
            <a href="${esc(urlBoton)}" style="display:inline-block; ${FONT} padding:13px 26px; font-size:14px; font-weight:700; letter-spacing:0.02em; color:#ffffff; text-decoration:none; text-align:center;">Abrir en Vialto&nbsp;&rarr;</a>
          </td>
        </tr></table>
      </td></tr>

      <tr><td class="px" style="padding:18px 28px; border-top:1px solid ${C.borde};">
        <p style="${FONT} margin:0 0 6px; font-size:12px; line-height:1.55; color:${C.steel};">
          Recibís este aviso porque estás en la lista de notificaciones${empresa ? ` de ${esc(empresa)}` : ''}.
          Podés elegir qué avisos llegan y a quién en
          <a href="${esc(urlConfig)}" style="color:${C.fire}; text-decoration:none; font-weight:700;">Configuración &rarr; Notificaciones</a>.
        </p>
        <p style="${FONT} margin:0; font-size:11px; color:${C.suave};">Vialto Software</p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;

  // Versión de texto: la muestran los clientes sin HTML y mejora la entrega (menos spam).
  const lineas: string[] = [label.toUpperCase(), empresa ?? '', intro ?? '', '', resumen];
  for (const t of tots) {
    lineas.push(`${t.sentido === 'cobrar' ? 'Total a cobrar' : 'Total a pagar'}: ${t.montos.map((m) => fmtMonto(m.monto, m.moneda)).join(' + ')}`);
  }
  let restantesTxt = MAX_TARJETAS;
  for (const s of secciones) {
    const visibles = s.items.slice(0, Math.max(restantesTxt, 0));
    restantesTxt -= visibles.length;
    if (visibles.length === 0) continue;
    lineas.push('', s.nombre ? `— ${s.nombre.toUpperCase()} (${s.items.length}) —` : '');
    for (const it of visibles) {
      lineas.push(`• ${it.titulo}`, `  ${it.detalle}`);
      if (it.url) lineas.push(`  ${urlApp(it.url)}`);
    }
  }
  if (ocultos > 0) lineas.push('', `Y ${ocultos} más.`);
  lineas.push('', `Abrir en Vialto: ${urlBoton}`, `Elegir qué avisos recibir: ${urlConfig}`);
  const text = lineas.filter((l, i, arr) => !(l === '' && arr[i - 1] === '')).join('\n').trim();

  return { subject, html, text };
}

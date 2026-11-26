import type { NotificacionFrecuencia } from './notificaciones-catalog';
import type { NotificacionItem, NotificacionTono } from './evaluators/notificacion-evaluator.interface';

/**
 * Email de notificaciones. Funciones puras: no leen la base ni envían nada, así se pueden
 * previsualizar (`npm run preview:email-notificacion`) y probar sin Resend.
 *
 * Fiel a la app y a la web (nov 2026): barra superior carbón como `AppShell` (logo chico + nombre
 * de la empresa), tipografías del sistema (Bebas Neue títulos y números, Barlow texto, Barlow
 * Condensed en mayúsculas para etiquetas y botones), esquinas rectas, cada sección como un bloque
 * "Pendientes" del dashboard (`DashboardPendientesMarco`: título + badge de cantidad + "Ver todo",
 * franja de montos y tabla con encabezados chicos) y pie oscuro como el `Footer` de la web.
 *
 * Reglas de email: todo con tablas y estilos inline. Las fuentes web cargan en Apple Mail, iOS y
 * Outlook para Mac; Gmail las ignora y usa la de respaldo (Arial Narrow / Arial). El `<style>` del
 * head solo ajusta mobile: los clientes que lo ignoran ven la versión de escritorio.
 */

/** Isotipo blanco de la web (vialto.uno, URL pública estable). */
const ISOTIPO_URL = 'https://vialto.uno/vialto-isotipo-blanco.png';
export const APP_URL = 'https://admin.vialto.uno';

/** Tope de filas por email: un tipo con cientos de avisos (cargas para revisar) no arma un mail interminable. */
export const MAX_TARJETAS = 20;

/** Colores de marca (`--color-vialto-*` de `index.css` del frontend). */
const C = {
  charcoal: '#1a1a1a',
  graphite: '#2e2e2e',
  fire: '#e8470a',
  steel: '#4a4a4a',
  mist: '#f5f3f0',
  borde: '#e6e6e6', // black/10 sobre blanco
  bordeSuave: '#f2f2f2', // black/5
};

/** Mismos tonos que los "Pendientes" del dashboard (rose / amber de Tailwind). */
const TONOS: Record<NotificacionTono, { acento: string; fondo: string; borde: string; texto: string }> = {
  alerta: { acento: '#e11d48', fondo: '#fff1f2', borde: '#ffe4e6', texto: '#be123c' },
  aviso: { acento: '#f59e0b', fondo: '#fffbeb', borde: '#fef3c7', texto: '#b45309' },
  info: { acento: C.steel, fondo: C.mist, borde: '#e7e3dc', texto: C.steel },
};

const F_DISPLAY = `font-family:'Bebas Neue','Oswald','Arial Narrow',Arial,sans-serif; font-weight:400;`;
const F_BODY = `font-family:Barlow,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;`;
const F_UI = `font-family:'Barlow Condensed','Arial Narrow',Arial,sans-serif;`;

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

type Seccion = { nombre: string | null; items: NotificacionItem[] };

/** Agrupa por `seccion` respetando el orden de llegada. */
function agruparSecciones(items: NotificacionItem[]): Seccion[] {
  const secciones: Seccion[] = [];
  for (const it of items) {
    const nombre = it.seccion ?? null;
    let s = secciones.find((x) => x.nombre === nombre);
    if (!s) {
      s = { nombre, items: [] };
      secciones.push(s);
    }
    s.items.push(it);
  }
  return secciones;
}

/** Color del badge de cantidad: rojo si hay algo urgente, si no ámbar, si no neutro. */
function tonoSeccion(s: Seccion): NotificacionTono {
  if (s.items.some((i) => i.tono === 'alerta')) return 'alerta';
  if (s.items.some((i) => i.tono === 'aviso')) return 'aviso';
  return 'info';
}

/** Línea de color arriba del bloque para separar a simple vista lo que entra (cobrar) de lo que sale (pagar). */
const COLOR_SENTIDO = { cobrar: '#059669', pagar: C.charcoal } as const;
function sentidoSeccion(s: Seccion): 'cobrar' | 'pagar' | null {
  const sentidos = new Set(s.items.map((i) => i.importe?.sentido ?? null));
  return sentidos.size === 1 ? ([...sentidos][0] ?? null) : null;
}

type Total = { sentido: 'cobrar' | 'pagar'; montos: { moneda: string; monto: number }[] };

/** Totales por sentido y moneda (nunca se suman monedas distintas). ARS primero. */
function totales(items: NotificacionItem[]): Total[] {
  const res: Total[] = [];
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

/** "3 a cobrar a clientes, 2 a pagar a proveedores" o "5 avisos nuevos" (asunto, preheader y texto plano). */
function resumenCorto(secciones: Seccion[], total: number): string {
  const conNombre = secciones.filter((s) => s.nombre);
  if (conNombre.length > 0) return conNombre.map((s) => `${s.items.length} ${s.nombre!.toLowerCase()}`).join(', ');
  return cantidadAvisos(total);
}

function cantidadAvisos(n: number): string {
  return n === 1 ? '1 aviso nuevo' : `${n} avisos nuevos`;
}

const ENCABEZADO_FRECUENCIA: Record<NotificacionFrecuencia, string> = {
  diaria: 'Resumen diario',
  semanal: 'Resumen semanal',
  inmediata: 'Aviso',
};

function fechaLarga(d: Date): string {
  return d.toLocaleDateString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

/** Logo como el de la web: isotipo + "VIAL" blanco + "TO." naranja + "SOFTWARE". Chico. */
function logo(): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0"><tr>
    <td valign="middle" style="padding-right:7px;"><img src="${ISOTIPO_URL}" alt="" width="27" height="22" style="display:block; width:27px; height:22px; border:0;" /></td>
    <td valign="middle" style="line-height:1;">
      <div style="${F_DISPLAY} font-size:19px; line-height:17px; letter-spacing:0.02em; color:#ffffff;">VIAL<span style="color:${C.fire};">TO.</span></div>
      <div style="${F_UI} font-size:8px; line-height:9px; font-weight:600; letter-spacing:0.28em; text-transform:uppercase; color:rgba(255,255,255,0.85);">Software</div>
    </td>
  </tr></table>`;
}

/** Badge de estado como los de la app: mayúsculas, condensada, borde y fondo del tono. */
function badgeEstado(texto: string, tono: NotificacionTono): string {
  const t = TONOS[tono];
  return `<span style="display:inline-block; ${F_UI} font-size:11px; font-weight:600; line-height:1; letter-spacing:0.05em; text-transform:uppercase; padding:4px 6px; border:1px solid ${t.borde}; background-color:${t.fondo}; color:${t.texto};">${esc(texto)}</span>`;
}

const TH = `${F_UI} padding:8px 0; font-size:11px; font-weight:400; letter-spacing:0.15em; text-transform:uppercase; color:${C.steel}; border-bottom:1px solid ${C.borde};`;

function fila(it: NotificacionItem, conImporte: boolean): string {
  const tono = it.tono ?? 'info';
  const href = it.url ? esc(urlApp(it.url)) : null;
  const principal = it.encabezado ?? it.titulo;
  const titulo = href
    ? `<a href="${href}" style="color:${C.charcoal}; text-decoration:none;">${esc(principal)}</a>`
    : esc(principal);
  // Con datos estructurados, el `detalle` (texto de la campana) sería repetido: se muestra solo como respaldo.
  const segunda = it.subtitulo ?? (it.etiqueta ? null : it.detalle);
  const td = `border-bottom:1px solid ${C.bordeSuave};`;
  return `<tr>
    <td valign="top" style="${td} padding:10px 12px 10px 0;">
      <div style="${F_BODY} font-size:14px; font-weight:600; line-height:1.35; color:${C.charcoal};">${titulo}</div>
      ${segunda ? `<div style="${F_BODY} padding-top:2px; font-size:12px; line-height:1.4; color:${C.steel};">${esc(segunda)}</div>` : ''}
      ${it.etiqueta ? `<div style="padding-top:6px;">${badgeEstado(it.etiqueta, tono)}</div>` : ''}
    </td>
    ${
      conImporte
        ? `<td class="monto" valign="top" align="right" style="${td} ${F_BODY} padding:10px 12px 10px 0; white-space:nowrap; font-size:14px; font-weight:600; color:${C.charcoal};">${it.importe ? esc(fmtMonto(it.importe.monto, it.importe.moneda)) : ''}</td>`
        : ''
    }
    <td valign="top" align="right" style="${td} padding:11px 0 10px;">${
      href
        ? `<a href="${href}" style="${F_UI} font-size:12px; font-weight:700; letter-spacing:0.12em; text-transform:uppercase; color:${C.fire}; text-decoration:none; white-space:nowrap;">Ver&nbsp;&rsaquo;</a>`
        : ''
    }</td>
  </tr>`;
}

/**
 * Una sección como un bloque "Pendientes" del dashboard: título + badge de cantidad, franja con el
 * total (si los ítems tienen sentido cobrar/pagar) y la tabla. Sin "Ver todo": el botón principal
 * del email ya lleva ahí.
 */
function bloqueSeccion(s: Seccion, visibles: NotificacionItem[]): string {
  const t = TONOS[tonoSeccion(s)];
  const sentido = sentidoSeccion(s);
  const conImporte = s.items.some((i) => i.importe);
  const etiquetaImporte = s.items.some((i) => i.importe?.sentido) ? 'Saldo' : 'Importe';
  const ocultos = s.items.length - visibles.length;
  const total = sentido ? totales(s.items)[0] : undefined;
  // Sin nombre de sección, el título del email ya dice qué es: el bloque solo muestra la cantidad.
  const titulo = s.nombre ? esc(s.nombre) : cantidadAvisos(s.items.length);

  const franja = total
    ? (() => {
        const [principal, ...resto] = total.montos;
        return `<tr><td style="padding:0 16px 12px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${C.mist}; border:1px solid #ebe8e3;"><tr><td style="padding:8px 12px;">
            <div style="${F_UI} font-size:11px; letter-spacing:0.12em; text-transform:uppercase; color:${C.steel};">${sentido === 'cobrar' ? 'Total a cobrar' : 'Total a pagar'}</div>
            <span style="${F_DISPLAY} font-size:26px; line-height:28px; letter-spacing:0.03em; color:${C.charcoal};">${esc(fmtMonto(principal.monto, principal.moneda))}</span>
            ${resto.map((m) => `<span style="${F_DISPLAY} padding-left:8px; font-size:18px; line-height:28px; letter-spacing:0.03em; color:#5f5f5f;">+ ${esc(fmtMonto(m.monto, m.moneda))}</span>`).join('')}
          </td></tr></table>
        </td></tr>`;
      })()
    : '';

  return `
  <tr><td style="padding:0 0 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#ffffff; border:1px solid ${C.borde};${sentido ? ` border-top:3px solid ${COLOR_SENTIDO[sentido]};` : ''}">
      <tr><td style="padding:14px 16px 12px; ${F_BODY} font-size:15px; font-weight:600; color:${C.charcoal};">
        ${titulo}${
          s.nombre
            ? `<span style="display:inline-block; margin-left:8px; min-width:12px; padding:4px 7px; ${F_BODY} font-size:12px; font-weight:700; line-height:1; text-align:center; background-color:${t.acento}; color:#ffffff; vertical-align:1px;">${s.items.length}</span>`
            : ''
        }
      </td></tr>
      ${franja}
      <tr><td style="padding:0 16px 6px; border-top:1px solid ${C.borde};">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <th align="left" style="${TH}">Detalle</th>
            ${conImporte ? `<th align="right" style="${TH} padding-right:12px;">${etiquetaImporte}</th>` : ''}
            <th align="right" style="${TH}">&nbsp;</th>
          </tr>
          ${visibles.map((i) => fila(i, conImporte)).join('')}
        </table>
        ${
          ocultos > 0
            ? `<p style="${F_BODY} margin:10px 0 6px; font-size:13px; color:${C.steel};">Y ${ocultos} ${ocultos === 1 ? 'aviso más' : 'avisos más'} en Vialto.</p>`
            : ''
        }
      </td></tr>
    </table>
  </td></tr>`;
}

/** Filas por sección: el tope se reparte para que ningún bloque (ej. proveedores) quede afuera. */
function cupoPorSeccion(secciones: Seccion[]): number {
  return Math.max(5, Math.floor(MAX_TARJETAS / Math.max(secciones.length, 1)));
}

export function armarEmailNotificacion(input: EmailNotificacionInput): EmailNotificacion {
  const { label, intro, empresa, frecuencia, items, rutaBoton } = input;
  const fecha = input.fecha ?? new Date();
  const secciones = agruparSecciones(items);
  const tots = totales(items);
  const resumen = resumenCorto(secciones, items.length);
  const urlBoton = urlApp(rutaBoton);
  const urlConfig = urlApp('/configuracion/notificaciones');
  const anio = fecha.getFullYear();

  const cupo = cupoPorSeccion(secciones);
  const cuerpo = secciones.map((s) => bloqueSeccion(s, s.items.slice(0, cupo))).join('');

  const subject = `${label}: ${resumen}${empresa ? ` · ${empresa}` : ''}`;
  const preheader = [
    resumen,
    ...tots.map((t) => `${t.sentido === 'cobrar' ? 'A cobrar' : 'A pagar'} ${t.montos.map((m) => fmtMonto(m.monto, m.moneda)).join(' + ')}`),
  ].join(' · ');

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light only" />
<meta name="supported-color-schemes" content="light" />
<title>${esc(label)}</title>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Barlow:wght@400;500;600;700&family=Barlow+Condensed:wght@400;600;700&display=swap" rel="stylesheet" />
<style>
  @media (max-width: 520px) {
    .px { padding-left: 16px !important; padding-right: 16px !important; }
    .h1 { font-size: 30px !important; line-height: 30px !important; }
    .tile { display: block !important; width: 100% !important; padding: 0 0 10px 0 !important; }
    .empresa { display: none !important; }
    .btn a { display: block !important; }
  }
</style>
</head>
<body style="margin:0; padding:0; background-color:${C.mist};">
<div style="display:none; max-height:0; overflow:hidden; opacity:0; color:transparent;">${esc(preheader)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${C.mist};">
  <tr><td align="center" style="padding:24px 12px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;">

      <tr><td class="px" style="background-color:${C.charcoal}; padding:12px 20px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td valign="middle" width="1">${logo()}</td>
          ${
            empresa
              ? `<td valign="middle" style="padding-left:12px;"><div style="border-left:1px solid rgba(255,255,255,0.12); padding-left:12px; ${F_UI} font-size:12px; letter-spacing:0.04em; color:rgba(255,255,255,0.55);">${esc(empresa)}</div></td>`
              : '<td></td>'
          }
        </tr></table>
      </td></tr>
      <tr><td style="height:3px; line-height:3px; font-size:0; background-color:${C.fire};">&nbsp;</td></tr>

      <tr><td class="px" style="padding:26px 4px 18px;">
        <p style="${F_UI} margin:0 0 8px; font-size:12px; font-weight:600; letter-spacing:0.3em; text-transform:uppercase; color:${C.fire};">${ENCABEZADO_FRECUENCIA[frecuencia]} · ${esc(fechaLarga(fecha))}</p>
        <h1 class="h1" style="${F_DISPLAY} margin:0; font-size:36px; line-height:36px; letter-spacing:0.03em; text-transform:uppercase; color:${C.charcoal};">${esc(label)}</h1>
        ${intro ? `<p style="${F_BODY} margin:10px 0 0; font-size:15px; line-height:1.5; color:${C.steel};">${esc(intro)}</p>` : ''}
      </td></tr>

      <tr><td class="px" style="padding:0 0 4px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          ${cuerpo}
        </table>
      </td></tr>

      <tr><td class="px" style="padding:4px 0 28px;">
        <table role="presentation" cellpadding="0" cellspacing="0" class="btn"><tr>
          <td style="background-color:${C.fire};">
            <a href="${esc(urlBoton)}" style="display:inline-block; ${F_UI} padding:14px 28px; font-size:15px; font-weight:600; letter-spacing:0.18em; text-transform:uppercase; color:#ffffff; text-decoration:none; text-align:center;">Abrir en Vialto&nbsp;&rsaquo;</a>
          </td>
        </tr></table>
      </td></tr>

      <tr><td class="px" style="background-color:${C.charcoal}; padding:18px 24px;">
        <p style="${F_BODY} margin:0; font-size:13px; line-height:1.55; color:rgba(255,255,255,0.7);">
          Elegí qué avisos llegan y a quién en
          <a href="${esc(urlConfig)}" style="color:${C.fire}; text-decoration:none; font-weight:600;">Configuración &rsaquo; Notificaciones</a>.
        </p>
        <p style="${F_BODY} margin:12px 0 0; padding-top:12px; border-top:1px solid rgba(255,255,255,0.1); font-size:12px; color:rgba(255,255,255,0.5);">
          &copy; ${anio} Vialto Software · Plataforma de gestión para empresas de transporte y logística
        </p>
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
  for (const s of secciones) {
    const visibles = s.items.slice(0, cupo);
    lineas.push('', s.nombre ? `${s.nombre.toUpperCase()} (${s.items.length})` : '');
    for (const it of visibles) {
      lineas.push(`• ${it.encabezado ?? it.titulo}`, `  ${[it.subtitulo, it.detalle || it.etiqueta].filter(Boolean).join(' · ')}`);
      if (it.url) lineas.push(`  ${urlApp(it.url)}`);
    }
    if (s.items.length > visibles.length) lineas.push(`  Y ${s.items.length - visibles.length} más.`);
  }
  lineas.push('', `Abrir en Vialto: ${urlBoton}`, `Elegir qué avisos recibir: ${urlConfig}`);
  const text = lineas.filter((l, i, arr) => !(l === '' && arr[i - 1] === '')).join('\n').trim();

  return { subject, html, text };
}

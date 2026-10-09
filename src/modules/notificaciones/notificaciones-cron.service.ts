import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { UsersService } from '../../core/users/users.service';
import { ResendEmailService } from '../../shared/email/resend-email.service';
import { NotificacionesConfigService } from './notificaciones-config.service';
import {
  getNotificacionesCatalogoPorModulos,
  NOTIFICACIONES_CATALOG,
  type NotificacionCatalogoItem,
  type NotificacionFrecuencia,
} from './notificaciones-catalog';
import { FacturaPorVencerEvaluator } from './evaluators/factura-por-vencer.evaluator';
import { FacturaVencidaEvaluator } from './evaluators/factura-vencida.evaluator';
import { CargaSospechosaEvaluator } from './evaluators/carga-sospechosa.evaluator';
import { CuentaCorrienteVencimientoEvaluator } from './evaluators/cuenta-corriente-vencimiento.evaluator';
import { LiquidacionPendienteAnulacionEvaluator } from './evaluators/liquidacion-pendiente-anulacion.evaluator';
import type { NotificacionEvaluator, NotificacionItem } from './evaluators/notificacion-evaluator.interface';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Logo servido desde el sitio en producción (URL pública estable) — un cliente de email no puede resolver rutas relativas ni localhost. */
const LOGO_URL = 'https://admin.vialto.uno/vialto-software-white-removebg.png';
const APP_URL = 'https://admin.vialto.uno';

/** Mismos colores de marca que `index.css` (`--color-vialto-*`) del frontend. */
const COLOR_CHARCOAL = '#1a1a1a';
const COLOR_FIRE = '#e8470a';
const COLOR_STEEL = '#4a4a4a';
const COLOR_MIST = '#f5f3f0';

/**
 * Cron diario que evalúa el catálogo de notificaciones para cada tenant y manda un email
 * agrupado por tipo (solo si está activo para ese tenant y hay ítems nuevos — dedup por
 * `NotificacionEnvio`). Destinatarios: por default todos los `org:admin` del tenant, salvo que el
 * tenant haya elegido usuarios puntuales para ese tipo (`NotificacionConfig.destinatarios`).
 */
@Injectable()
export class NotificacionesCronService {
  private readonly logger = new Logger(NotificacionesCronService.name);
  /** Los propios de este módulo + los que registran los módulos vendibles (ver `registrarEvaluator`). */
  private readonly evaluators: NotificacionEvaluator[];

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: NotificacionesConfigService,
    private readonly emailService: ResendEmailService,
    private readonly usersService: UsersService,
    facturaPorVencer: FacturaPorVencerEvaluator,
    facturaVencida: FacturaVencidaEvaluator,
    cargaSospechosa: CargaSospechosaEvaluator,
    cuentaCorrienteVencimiento: CuentaCorrienteVencimientoEvaluator,
    liquidacionPendienteAnulacion: LiquidacionPendienteAnulacionEvaluator,
  ) {
    this.evaluators = [
      facturaPorVencer,
      facturaVencida,
      cargaSospechosa,
      cuentaCorrienteVencimiento,
      liquidacionPendienteAnulacion,
    ];
  }

  /**
   * Punto de extensión para que un módulo vendible sume sus avisos sin que `notificaciones`
   * dependa de él (ej. Mantenimiento registra los suyos en `onModuleInit`, reusando su propio
   * cálculo). El `tipo` tiene que estar en `NOTIFICACIONES_CATALOG` y no puede repetirse: si
   * no, falla el arranque — mejor eso que un aviso que nunca sale.
   */
  registrarEvaluator(evaluator: NotificacionEvaluator): void {
    if (!NOTIFICACIONES_CATALOG.some((c) => c.tipo === evaluator.tipo)) {
      throw new Error(`registrarEvaluator: el tipo "${evaluator.tipo}" no está en NOTIFICACIONES_CATALOG`);
    }
    if (this.evaluators.some((e) => e.tipo === evaluator.tipo)) {
      throw new Error(`registrarEvaluator: ya hay un evaluator para "${evaluator.tipo}"`);
    }
    this.evaluators.push(evaluator);
  }

  /**
   * 8:00 hora Argentina — para que el admin lo tenga en la bandeja de entrada al arrancar
   * el día. Solo procesa tipos `frecuencia: 'diaria'` — los `'semanal'` van por `cronSemanal`.
   */
  @Cron('0 8 * * *', { timeZone: 'America/Argentina/Buenos_Aires' })
  async cronDiario(): Promise<void> {
    this.logger.log('Ejecutando cron de notificaciones...');
    const tenants = await this.prisma.tenant.findMany({
      select: { clerkOrgId: true, modules: true },
    });
    for (const t of tenants) {
      try {
        await this.procesarTenant(t.clerkOrgId, t.modules, 'diaria');
      } catch (err) {
        this.logger.error(`Error procesando notificaciones del tenant ${t.clerkOrgId}: ${err}`);
      }
    }
  }

  /**
   * Lunes 8:00 hora Argentina — tipos `frecuencia: 'semanal'` sin `cronPropio` (ej.
   * `liquidaciones.pendienteAnulacion`). Los que tienen `cronPropio` los dispara el cron de su
   * módulo (`combustible.cargaSospechosa` → `CombustibleCorreccionCronService.cronSemanal`).
   */
  @Cron('0 8 * * 1', { timeZone: 'America/Argentina/Buenos_Aires' })
  async cronSemanal(): Promise<void> {
    this.logger.log('Ejecutando cron semanal de notificaciones...');
    const tipos = NOTIFICACIONES_CATALOG.filter(
      (c) => c.frecuencia === 'semanal' && !c.cronPropio,
    ).map((c) => c.tipo);
    const tenants = await this.prisma.tenant.findMany({
      select: { clerkOrgId: true, modules: true },
    });
    for (const t of tenants) {
      try {
        await this.procesarTenant(t.clerkOrgId, t.modules, 'semanal', tipos);
      } catch (err) {
        this.logger.error(`Error procesando notificaciones semanales del tenant ${t.clerkOrgId}: ${err}`);
      }
    }
  }

  /**
   * Evalúa y envía las notificaciones de un tenant puntual — usado por el cron diario, por
   * el cron semanal de un módulo puntual (con `frecuencia` filtrando a ese tipo) y por el
   * trigger manual de superadmin (sin `frecuencia`, procesa todo el catálogo aplicable).
   * `tipos` acota a esos tipos (el cron de un módulo procesa solo los suyos).
   */
  async procesarTenant(
    tenantId: string,
    modules: string[],
    frecuencia?: NotificacionFrecuencia,
    tipos?: string[],
  ): Promise<void> {
    const catalogo = getNotificacionesCatalogoPorModulos(modules, frecuencia).filter(
      (item) => !tipos || tipos.includes(item.tipo),
    );

    for (const item of catalogo) {
      const evaluator = this.evaluators.find((e) => e.tipo === item.tipo);
      if (!evaluator) continue;

      const activo = await this.configService.isActivo(tenantId, item.tipo);
      if (!activo) continue;

      const candidatas = await evaluator.evaluar(tenantId);
      await this.enviarYRegistrar(tenantId, item, candidatas);
    }
  }

  /**
   * Avisa en el momento (sin esperar a ningún cron) — para tipos `frecuencia: 'inmediata'`
   * que dispara el propio flujo de negocio, ej. `combustible.errorChofer` al registrar el
   * error. Respeta lo mismo que el cron: módulo contratado, toggle del tenant y dedup por
   * `entidadId`. Best-effort: nunca tira, para no romper el flujo que lo llama.
   */
  async notificarAhora(tenantId: string, tipo: string, aviso: NotificacionItem): Promise<void> {
    try {
      const item = NOTIFICACIONES_CATALOG.find((c) => c.tipo === tipo);
      if (!item) throw new Error(`tipo de notificación desconocido: ${tipo}`);
      const tenant = await this.prisma.tenant.findUnique({
        where: { clerkOrgId: tenantId },
        select: { modules: true },
      });
      if (!tenant?.modules.includes(item.requiereModulo)) return;
      if (!(await this.configService.isActivo(tenantId, tipo))) return;
      await this.enviarYRegistrar(tenantId, item, [aviso]);
    } catch (err) {
      this.logger.error(`[${tenantId}] ${tipo}: no se pudo notificar en el momento: ${err}`);
    }
  }

  /** Filtra lo ya avisado (dedup por entidadId), manda un email agrupado y lo registra en la campana. */
  private async enviarYRegistrar(
    tenantId: string,
    item: NotificacionCatalogoItem,
    candidatas: NotificacionItem[],
  ): Promise<void> {
    if (candidatas.length === 0) return;

    const yaNotificadas = await this.prisma.notificacionEnvio.findMany({
      where: {
        tenantId,
        tipo: item.tipo,
        entidadId: { in: candidatas.map((c) => c.entidadId) },
      },
      select: { entidadId: true },
    });
    const yaNotificadasSet = new Set(yaNotificadas.map((n) => n.entidadId));
    const nuevas = candidatas.filter((c) => !yaNotificadasSet.has(c.entidadId));
    if (nuevas.length === 0) return;

    const destinatarios = await this.resolverDestinatarios(tenantId, item.tipo);
    if (destinatarios.length === 0) {
      this.logger.warn(`[${tenantId}] ${item.tipo}: sin destinatarios (sin admins/usuarios elegidos con email en Clerk) — no se envía.`);
      return;
    }

    const enviado = await this.emailService.send({
      to: destinatarios,
      subject: `Vialto - ${item.label}${nuevas.length > 1 ? ` (${nuevas.length})` : ''}`,
      html: this.buildHtml(item.label, nuevas, `${APP_URL}${item.urlDestino ?? ''}`),
    });

    if (!enviado) {
      this.logger.warn(
        `[${tenantId}] ${item.tipo}: el email no se pudo enviar, pero la notificación se registrará internamente en la campana.`,
      );
    }

    await this.prisma.notificacionEnvio.createMany({
      data: nuevas.map((c) => ({
        tenantId,
        tipo: item.tipo,
        entidadId: c.entidadId,
        titulo: c.titulo,
        detalle: c.detalle,
        destinatarios,
      })),
      skipDuplicates: true,
    });

    this.logger.log(
      `[${tenantId}] ${item.tipo}: enviado a ${destinatarios.length} destinatario(s), ${nuevas.length} ítem(s).`,
    );
  }

  /**
   * Emails de los destinatarios de un tipo de notificación. Si el tenant eligió usuarios puntuales
   * (`NotificacionConfig.destinatarios`), manda solo a esos (sin importar su rol). Si no hay override,
   * default: todos los `org:admin` del tenant.
   */
  private async resolverDestinatarios(tenantId: string, tipo: string): Promise<string[]> {
    const [miembros, destinatariosElegidos] = await Promise.all([
      this.usersService.listByTenant(tenantId),
      this.configService.getDestinatarios(tenantId, tipo),
    ]);

    if (destinatariosElegidos.length > 0) {
      const emailPorUserId = new Map(miembros.map((m) => [m.userId, m.email]));
      return destinatariosElegidos
        .map((userId) => emailPorUserId.get(userId))
        .filter((email): email is string => !!email && !email.endsWith('@example.com'));
    }

    return miembros
      .filter((m) => m.role === 'org:admin' && !!m.email && !m.email.endsWith('@example.com'))
      .map((m) => m.email as string);
  }

  private buildHtml(label: string, items: NotificacionItem[], urlBoton: string): string {
    const tarjetas = items
      .map(
        (i) => `
          <tr>
            <td style="padding-bottom:12px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e7e3dc; border-radius:8px;">
                <tr>
                  <td style="padding:14px 16px;">
                    <p style="margin:0 0 4px; font-family:Arial, sans-serif; font-size:14px; font-weight:700; color:${COLOR_CHARCOAL};">${escapeHtml(i.titulo)}</p>
                    <p style="margin:0; font-family:Arial, sans-serif; font-size:13px; line-height:1.5; color:${COLOR_STEEL};">${escapeHtml(i.detalle)}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>`,
      )
      .join('');

    return `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${COLOR_MIST}; padding:32px 16px;">
        <tr>
          <td align="center">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px; background-color:#ffffff; border-radius:10px; overflow:hidden;">
              <tr>
                <td align="center" style="background-color:${COLOR_CHARCOAL}; padding:22px 32px; text-align:center;">
                  <img src="${LOGO_URL}" alt="Vialto Software" width="130" style="display:block; height:auto; border:0; margin:0 auto;" />
                </td>
              </tr>
              <tr>
                <td style="padding:32px;">
                  <p style="margin:0 0 6px; font-family:Arial, sans-serif; font-size:11px; font-weight:700; letter-spacing:0.14em; text-transform:uppercase; color:${COLOR_FIRE};">
                    Aviso de Vialto
                  </p>
                  <h1 style="margin:0 0 20px; font-family:Arial, sans-serif; font-size:21px; line-height:1.3; color:${COLOR_CHARCOAL};">
                    ${escapeHtml(label)}
                  </h1>
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                    ${tarjetas}
                  </table>
                  <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:8px;">
                    <tr>
                      <td style="border-radius:6px; background-color:${COLOR_CHARCOAL};">
                        <a href="${urlBoton}" style="display:inline-block; padding:11px 22px; font-family:Arial, sans-serif; font-size:13px; font-weight:700; letter-spacing:0.04em; color:#ffffff; text-decoration:none;">
                          Ver en Vialto
                        </a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td style="padding:18px 32px; background-color:${COLOR_MIST}; border-top:1px solid #e7e3dc;">
                  <p style="margin:0; font-family:Arial, sans-serif; font-size:12px; line-height:1.5; color:${COLOR_STEEL};">
                    Podés elegir qué avisos recibís desde
                    <a href="${APP_URL}/configuracion/notificaciones" style="color:${COLOR_FIRE}; text-decoration:none;">Configuración → Notificaciones</a>
                    en Vialto.
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    `;
  }
}

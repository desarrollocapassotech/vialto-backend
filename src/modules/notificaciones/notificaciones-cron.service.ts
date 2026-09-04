import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { UsersService } from '../../core/users/users.service';
import { ResendEmailService } from '../../shared/email/resend-email.service';
import { NotificacionesConfigService } from './notificaciones-config.service';
import { getNotificacionesCatalogoPorModulos } from './notificaciones-catalog';
import { FacturaPorVencerEvaluator } from './evaluators/factura-por-vencer.evaluator';
import { CargaSospechosaEvaluator } from './evaluators/carga-sospechosa.evaluator';
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
  private readonly evaluators: NotificacionEvaluator[];

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: NotificacionesConfigService,
    private readonly emailService: ResendEmailService,
    private readonly usersService: UsersService,
    facturaPorVencer: FacturaPorVencerEvaluator,
    cargaSospechosa: CargaSospechosaEvaluator,
  ) {
    this.evaluators = [facturaPorVencer, cargaSospechosa];
  }

  /** 8:00 hora Argentina — para que el admin lo tenga en la bandeja de entrada al arrancar el día. */
  @Cron('0 8 * * *', { timeZone: 'America/Argentina/Buenos_Aires' })
  async cronDiario(): Promise<void> {
    this.logger.log('Ejecutando cron de notificaciones...');
    const tenants = await this.prisma.tenant.findMany({
      select: { clerkOrgId: true, modules: true },
    });
    for (const t of tenants) {
      try {
        await this.procesarTenant(t.clerkOrgId, t.modules);
      } catch (err) {
        this.logger.error(`Error procesando notificaciones del tenant ${t.clerkOrgId}: ${err}`);
      }
    }
  }

  /** Evalúa y envía las notificaciones de un tenant puntual — usado por el cron y por el trigger manual de superadmin. */
  async procesarTenant(tenantId: string, modules: string[]): Promise<void> {
    const catalogo = getNotificacionesCatalogoPorModulos(modules);

    for (const item of catalogo) {
      const evaluator = this.evaluators.find((e) => e.tipo === item.tipo);
      if (!evaluator) continue;

      const activo = await this.configService.isActivo(tenantId, item.tipo);
      if (!activo) continue;

      const candidatas = await evaluator.evaluar(tenantId);
      if (candidatas.length === 0) continue;

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
      if (nuevas.length === 0) continue;

      const destinatarios = await this.resolverDestinatarios(tenantId, item.tipo);
      if (destinatarios.length === 0) {
        this.logger.warn(`[${tenantId}] ${item.tipo}: sin destinatarios (sin admins/usuarios elegidos con email en Clerk) — no se envía.`);
        continue;
      }

      const enviado = await this.emailService.send({
        to: destinatarios,
        subject: `Vialto — ${item.label}${nuevas.length > 1 ? ` (${nuevas.length})` : ''}`,
        html: this.buildHtml(item.label, nuevas),
      });

      if (!enviado) {
        this.logger.warn(
          `[${tenantId}] ${item.tipo}: el email no se pudo enviar — no se marca como notificado, se reintenta en la próxima corrida.`,
        );
        continue;
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
        .filter((email): email is string => !!email);
    }

    return miembros
      .filter((m) => m.role === 'org:admin' && !!m.email)
      .map((m) => m.email as string);
  }

  private buildHtml(label: string, items: NotificacionItem[]): string {
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
                        <a href="${APP_URL}" style="display:inline-block; padding:11px 22px; font-family:Arial, sans-serif; font-size:13px; font-weight:700; letter-spacing:0.04em; color:#ffffff; text-decoration:none;">
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

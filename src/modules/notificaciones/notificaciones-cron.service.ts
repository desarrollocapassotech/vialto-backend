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

/**
 * Cron diario que evalúa el catálogo de notificaciones para cada tenant y manda un email
 * agrupado por tipo (solo si está activo para ese tenant y hay ítems nuevos — dedup por
 * `NotificacionEnvio`). Los destinatarios son los miembros `org:admin` del tenant en Clerk.
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

      const destinatarios = await this.resolverDestinatarios(tenantId);
      if (destinatarios.length === 0) {
        this.logger.warn(`[${tenantId}] ${item.tipo}: sin destinatarios (sin admins con email en Clerk) — no se envía.`);
        continue;
      }

      await this.emailService.send({
        to: destinatarios,
        subject: `Vialto — ${item.label}${nuevas.length > 1 ? ` (${nuevas.length})` : ''}`,
        html: this.buildHtml(item.label, nuevas),
      });

      await this.prisma.notificacionEnvio.createMany({
        data: nuevas.map((c) => ({
          tenantId,
          tipo: item.tipo,
          entidadId: c.entidadId,
          destinatarios,
        })),
        skipDuplicates: true,
      });

      this.logger.log(
        `[${tenantId}] ${item.tipo}: enviado a ${destinatarios.length} destinatario(s), ${nuevas.length} ítem(s).`,
      );
    }
  }

  private async resolverDestinatarios(tenantId: string): Promise<string[]> {
    const miembros = await this.usersService.listByTenant(tenantId);
    return miembros
      .filter((m) => m.role === 'org:admin' && !!m.email)
      .map((m) => m.email as string);
  }

  private buildHtml(label: string, items: NotificacionItem[]): string {
    const filas = items
      .map(
        (i) =>
          `<li style="margin-bottom:10px;"><strong>${escapeHtml(i.titulo)}</strong><br/><span style="color:#555;">${escapeHtml(i.detalle)}</span></li>`,
      )
      .join('');

    return `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #1a1a1a;">
        <h2 style="margin-bottom: 16px;">${escapeHtml(label)}</h2>
        <ul style="padding-left: 18px; margin: 0;">${filas}</ul>
        <p style="color: #888; font-size: 12px; margin-top: 24px;">
          Podés desactivar este aviso desde Configuración → Notificaciones en Vialto.
        </p>
      </div>
    `;
  }
}

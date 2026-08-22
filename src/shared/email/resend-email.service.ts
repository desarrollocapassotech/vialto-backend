import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';

export type SendEmailParams = {
  to: string[];
  subject: string;
  html: string;
};

/**
 * Envío de emails transaccionales vía Resend. Si `RESEND_API_KEY` no está configurada
 * (dev local, o un tenant sin nada que enviar todavía), el envío se salta con un log —
 * nunca rompe el flujo que lo llama (ej. el cron de notificaciones).
 */
@Injectable()
export class ResendEmailService {
  private readonly logger = new Logger(ResendEmailService.name);
  private readonly client: Resend | null;
  private readonly from: string;

  constructor() {
    const apiKey = process.env.RESEND_API_KEY;
    this.client = apiKey ? new Resend(apiKey) : null;
    this.from = process.env.RESEND_FROM_EMAIL ?? 'Vialto <notificaciones@vialto.app>';

    if (!this.client) {
      this.logger.warn(
        'RESEND_API_KEY no configurada — el envío de emails queda deshabilitado (solo se logueará).',
      );
    }
  }

  async send(params: SendEmailParams): Promise<void> {
    if (params.to.length === 0) return;

    if (!this.client) {
      this.logger.warn(
        `Email no enviado (Resend no configurado): "${params.subject}" → ${params.to.join(', ')}`,
      );
      return;
    }

    const { error } = await this.client.emails.send({
      from: this.from,
      to: params.to,
      subject: params.subject,
      html: params.html,
    });

    if (error) {
      this.logger.error(
        `Error enviando email "${params.subject}" a ${params.to.join(', ')}: ${JSON.stringify(error)}`,
      );
    }
  }
}

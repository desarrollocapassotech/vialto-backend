import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ResendEmailService } from '../../shared/email/resend-email.service';
import { CreateLeadDto, LEAD_CONTACTO, LEAD_NECESIDADES } from './dto/create-lead.dto';

const DESTINO_POR_DEFECTO = 'contacto@capasso.tech';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Leads de la landing (vialto.uno): no se guardan en la base, se mandan por mail
 * a `LEADS_EMAIL_TO` (por defecto contacto@capasso.tech) vía Resend.
 * No es dato de ningún tenant: no hay tenantId ni consulta a Prisma.
 */
@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);

  constructor(private readonly email: ResendEmailService) {}

  async registrar(dto: CreateLeadDto): Promise<void> {
    const to = (process.env.LEADS_EMAIL_TO ?? DESTINO_POR_DEFECTO)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const enviado = await this.email.send({
      to,
      subject: `Nuevo interesado en Vialto: ${dto.empresa} (${dto.nombre})`,
      html: this.html(dto),
    });

    if (!enviado) {
      // El lead no se guarda en ningún otro lado: queda en el log para no perderlo.
      this.logger.error(`Lead NO enviado por mail: ${JSON.stringify({ ...dto, sitio: undefined })}`);
      throw new ServiceUnavailableException(
        'No pudimos enviar tus datos. Probá de nuevo en un rato.',
      );
    }
  }

  private html(dto: CreateLeadDto): string {
    const necesidades = dto.necesidades
      .map((n) => (n === 'otro' && dto.otroDetalle ? `Otro: ${dto.otroDetalle}` : LEAD_NECESIDADES[n]))
      .map(esc)
      .join('<br>');
    const telDigitos = dto.telefono.replace(/[^\d+]/g, '');
    const telWa = telDigitos.replace(/^\+/, '');

    const filas: [string, string][] = [
      ['Empresa', esc(dto.empresa)],
      ['Nombre', esc(dto.nombre)],
      [
        'Teléfono',
        `<a href="tel:${esc(telDigitos)}">${esc(dto.telefono)}</a> · <a href="https://wa.me/${esc(telWa)}">Abrir WhatsApp</a>`,
      ],
      ['Prefiere', esc(LEAD_CONTACTO[dto.contactoPreferido])],
      ['Días y horarios', esc(dto.disponibilidad).replace(/\n/g, '<br>')],
      ['Necesita resolver', necesidades],
      ['Comentarios', dto.comentarios ? esc(dto.comentarios).replace(/\n/g, '<br>') : '—'],
      ['Origen', dto.origen ? esc(dto.origen) : '—'],
    ];

    return `
      <div style="font-family:Arial,sans-serif;color:#1A1A1A;max-width:560px">
        <h2 style="margin:0 0 12px;color:#E8470A">Nuevo interesado desde vialto.uno</h2>
        <table style="border-collapse:collapse;width:100%;font-size:14px">
          ${filas
            .map(
              ([k, v]) => `
            <tr>
              <td style="padding:8px 12px 8px 0;border-bottom:1px solid #eee;color:#4A4A4A;vertical-align:top;white-space:nowrap">${k}</td>
              <td style="padding:8px 0;border-bottom:1px solid #eee;vertical-align:top">${v}</td>
            </tr>`,
            )
            .join('')}
        </table>
      </div>`;
  }
}

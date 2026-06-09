import {
  BadGatewayException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { v2 as cloudinary, type UploadApiResponse } from 'cloudinary';

const MAX_REMITO_PDF_BYTES = 10 * 1024 * 1024;

@Injectable()
export class CloudinaryService {
  private readonly logger = new Logger(CloudinaryService.name);
  private configured = false;

  constructor() {
    if (process.env.CLOUDINARY_URL?.trim()) {
      // El SDK lee api_key, api_secret y cloud_name desde CLOUDINARY_URL.
      cloudinary.config({ secure: true });
      this.configured = true;
    } else if (this.isConfigured()) {
      cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET,
        secure: true,
      });
      this.configured = true;
    }
  }

  isConfigured(): boolean {
    if (process.env.CLOUDINARY_URL?.trim()) return true;
    return Boolean(
      process.env.CLOUDINARY_CLOUD_NAME &&
        process.env.CLOUDINARY_API_KEY &&
        process.env.CLOUDINARY_API_SECRET,
    );
  }

  logStatus(): void {
    if (this.isConfigured()) {
      this.logger.log('Cloudinary: variables presentes.');
    } else {
      this.logger.debug('Cloudinary: sin configuración.');
    }
  }

  private isPdfUpload(mimeType: string, originalName: string): boolean {
    return (
      mimeType === 'application/pdf' || String(originalName ?? '').toLowerCase().endsWith('.pdf')
    );
  }

  async uploadRemitoArchivo(
    tenantId: string,
    buffer: Buffer,
    originalName: string,
    mimeType: string,
  ): Promise<string> {
    if (!this.configured) {
      throw new ServiceUnavailableException(
        'El almacenamiento de remitos no está configurado. Contactá al administrador.',
      );
    }
    if (buffer.length > MAX_REMITO_PDF_BYTES) {
      throw new ServiceUnavailableException('El archivo no puede superar 10 MB.');
    }

    const isPdf = this.isPdfUpload(mimeType, originalName);
    const baseName = String(originalName ?? 'remito')
      .replace(/\.[^.]+$/i, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'remito';

    const publicId = `${Date.now()}-${baseName}`;

    try {
      const result = await new Promise<UploadApiResponse>((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder: `vialto/stock/remitos/${tenantId}`,
            resource_type: isPdf ? 'raw' : 'image',
            public_id: publicId,
            access_mode: 'public',
            type: 'upload',
          },
          (error, uploadResult) => {
            if (error || !uploadResult) {
              reject(error ?? new Error('Cloudinary no devolvió resultado'));
              return;
            }
            resolve(uploadResult);
          },
        );
        stream.end(buffer);
      });

      return result.secure_url;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error al subir el archivo';
      this.logger.error(`Cloudinary upload failed: ${message}`);
      throw new BadGatewayException(
        message.includes('Invalid cloud_name')
          ? 'Cloudinary mal configurado (cloud name inválido). Revisá las variables de entorno.'
          : 'No se pudo subir el remito. Intentá de nuevo más tarde.',
      );
    }
  }

  /** @deprecated Usar uploadRemitoArchivo */
  async uploadRemitoPdf(tenantId: string, buffer: Buffer, originalName: string): Promise<string> {
    return this.uploadRemitoArchivo(tenantId, buffer, originalName, 'application/pdf');
  }

  async uploadComprobanteArchivo(
    tenantId: string,
    buffer: Buffer,
    originalName: string,
    mimeType: string,
  ): Promise<string> {
    if (!this.configured) {
      throw new ServiceUnavailableException(
        'El almacenamiento de comprobantes no está configurado. Contactá al administrador.',
      );
    }
    if (buffer.length > MAX_REMITO_PDF_BYTES) {
      throw new ServiceUnavailableException('El archivo no puede superar 10 MB.');
    }

    const isPdf = this.isPdfUpload(mimeType, originalName);
    const baseName = String(originalName ?? 'comprobante')
      .replace(/\.[^.]+$/i, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'comprobante';

    const publicId = `${Date.now()}-${baseName}`;

    try {
      const result = await new Promise<UploadApiResponse>((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder: `vialto/comprobantes/${tenantId}`,
            resource_type: isPdf ? 'raw' : 'image',
            public_id: publicId,
            access_mode: 'public',
            type: 'upload',
          },
          (error, uploadResult) => {
            if (error || !uploadResult) {
              reject(error ?? new Error('Cloudinary no devolvió resultado'));
              return;
            }
            resolve(uploadResult);
          },
        );
        stream.end(buffer);
      });

      return result.secure_url;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error al subir el archivo';
      this.logger.error(`Cloudinary comprobante upload failed: ${message}`);
      throw new BadGatewayException(
        message.includes('Invalid cloud_name')
          ? 'Cloudinary mal configurado (cloud name inválido). Revisá las variables de entorno.'
          : 'No se pudo subir el comprobante. Intentá de nuevo más tarde.',
      );
    }
  }

  /** URL de entrega firmada (1 h) para recursos en nuestro Cloudinary. */
  resolveDeliveryUrl(storedUrl: string): string {
    const parsed = this.parseCloudinaryStoredUrl(storedUrl);
    if (!parsed) return storedUrl;

    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    return cloudinary.url(parsed.publicId, {
      resource_type: parsed.resourceType,
      type: 'upload',
      secure: true,
      sign_url: true,
      expires_at: expiresAt,
      ...(parsed.format ? { format: parsed.format } : {}),
    });
  }

  parseCloudinaryStoredUrl(
    url: string,
  ): { publicId: string; resourceType: 'raw' | 'image'; format?: string } | null {
    try {
      const parsed = new URL(url);
      if (!parsed.hostname.includes('res.cloudinary.com')) return null;

      const segments = parsed.pathname.split('/').filter(Boolean);
      const uploadIdx = segments.indexOf('upload');
      if (uploadIdx < 0 || uploadIdx + 1 >= segments.length) return null;

      const resourceType = segments[uploadIdx - 1];
      if (resourceType !== 'raw' && resourceType !== 'image') return null;

      let rest = segments.slice(uploadIdx + 1);
      if (rest[0]?.startsWith('s--')) rest = rest.slice(1);
      if (rest[0]?.startsWith('v') && /^v\d+$/.test(rest[0])) rest = rest.slice(1);

      const last = rest[rest.length - 1] ?? '';
      const extMatch = last.match(/\.([a-z0-9]+)$/i);
      const format = extMatch?.[1]?.toLowerCase();
      const publicId = rest.join('/').replace(/\.[^./]+$/, '');

      if (!publicId) return null;
      return { publicId, resourceType, format };
    } catch {
      return null;
    }
  }

  assertRemitoUrlForTenant(storedUrl: string, tenantId: string) {
    const normalized = storedUrl.trim();
    const parsed = this.parseCloudinaryStoredUrl(normalized);
    if (!parsed) return;

    const expectedPrefix = `vialto/stock/remitos/${tenantId}/`;
    if (!parsed.publicId.startsWith(expectedPrefix)) {
      throw new BadGatewayException('URL de remito no válida para esta empresa.');
    }
  }
}

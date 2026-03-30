import { Injectable, Logger } from '@nestjs/common';

/**
 * Subida a Cloudinary (firmas, documentos). Implementar upload cuando se integre el SDK.
 */
@Injectable()
export class CloudinaryService {
  private readonly logger = new Logger(CloudinaryService.name);

  isConfigured(): boolean {
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
}

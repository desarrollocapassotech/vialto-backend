import { Injectable, Logger } from '@nestjs/common';

/**
 * Admin SDK para Firestore (checklist en tiempo real, etc.).
 * Inicialización diferida cuando existen variables de entorno de servicio.
 */
@Injectable()
export class FirebaseAdminService {
  private readonly logger = new Logger(FirebaseAdminService.name);

  isConfigured(): boolean {
    return Boolean(
      process.env.FIREBASE_PROJECT_ID &&
        process.env.FIREBASE_CLIENT_EMAIL &&
        process.env.FIREBASE_PRIVATE_KEY,
    );
  }

  /** Reservado: cargar `firebase-admin` cuando se implementen escrituras servidor. */
  logStatus(): void {
    if (this.isConfigured()) {
      this.logger.log('Firebase Admin: variables presentes (SDK no cargado aún).');
    } else {
      this.logger.debug('Firebase Admin: sin configuración.');
    }
  }
}

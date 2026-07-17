import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';

const ALGORITHM_GCM = 'aes-256-gcm';
const ALGORITHM_CBC = 'aes-256-cbc';
const IV_GCM_LENGTH = 12; // Estándar de 12 bytes para AES-GCM

// Helper para obtener una clave estable de 32 bytes. Lanza error si la variable de entorno no está definida.
function getEncryptionKey(): Buffer {
  const keyStr = process.env.ARCA_ENCRYPTION_KEY;
  if (!keyStr) {
    throw new Error(
      'FATAL: La variable de entorno ARCA_ENCRYPTION_KEY no está configurada. El servidor debe iniciarse con una clave de cifrado válida.'
    );
  }
  return createHash('sha256').update(keyStr).digest();
}

/** Comprobación rápida (fail-fast) para asegurar que la clave de cifrado esté definida al inicio */
export function validateKeyConfigured(): void {
  if (!process.env.ARCA_ENCRYPTION_KEY) {
    throw new Error(
      'FATAL: La variable de entorno ARCA_ENCRYPTION_KEY no está configurada.'
    );
  }
}

const ENCRYPTED_CBC_PATTERN = /^[0-9a-fA-F]{32}:[0-9a-fA-F]+$/;
const ENCRYPTED_GCM_PATTERN = /^[0-9a-fA-F]{24}:[0-9a-fA-F]{32}:[0-9a-fA-F]+$/;

/** Verifica si un string coincide con el formato cifrado (CBC o GCM) */
export function isEncrypted(text: string): boolean {
  return ENCRYPTED_GCM_PATTERN.test(text) || ENCRYPTED_CBC_PATTERN.test(text);
}

/** Cifra un campo de texto usando AES-256-GCM */
export function encryptField(text?: string | null): string | null {
  if (!text) return null;
  const iv = randomBytes(IV_GCM_LENGTH);
  const cipher = createCipheriv(ALGORITHM_GCM, getEncryptionKey(), iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${tag}:${encrypted}`;
}

/** Descifra un campo de texto soportando GCM y CBC (para compatibilidad heredada). Lanza errores claros y controlados ante fallos. */
export function decryptField(encryptedText?: string | null): string | null {
  if (!encryptedText) return null;
  if (!isEncrypted(encryptedText)) {
    return encryptedText; // Ya está en texto plano
  }

  const parts = encryptedText.split(':');

  // Formato AES-256-GCM: ivHex (12 bytes/24 caracteres) : tagHex (16 bytes/32 caracteres) : ciphertextHex
  if (parts.length === 3 && parts[0].length === 24 && parts[1].length === 32) {
    try {
      const [ivHex, tagHex, encrypted] = parts;
      const iv = Buffer.from(ivHex, 'hex');
      const tag = Buffer.from(tagHex, 'hex');
      const decipher = createDecipheriv(ALGORITHM_GCM, getEncryptionKey(), iv);
      decipher.setAuthTag(tag);
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (error) {
      throw new Error(
        'Error al descifrar el campo (AES-256-GCM): El dato podría estar corrupto o la clave ARCA_ENCRYPTION_KEY es incorrecta.'
      );
    }
  }

  // Formato AES-256-CBC: ivHex (16 bytes/32 caracteres) : ciphertextHex
  if (parts.length === 2 && parts[0].length === 32) {
    try {
      const [ivHex, encrypted] = parts;
      const iv = Buffer.from(ivHex, 'hex');
      const decipher = createDecipheriv(ALGORITHM_CBC, getEncryptionKey(), iv);
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (error) {
      throw new Error(
        'Error al descifrar el campo heredado (AES-256-CBC): El dato podría estar corrupto o la clave ARCA_ENCRYPTION_KEY es incorrecta.'
      );
    }
  }

  throw new Error(
    'Error al descifrar el campo: Formato de cifrado desconocido o inválido.'
  );
}

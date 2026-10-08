import { BadRequestException } from '@nestjs/common';
import { cuitDigitoVerificadorValido } from './cuit';

const LABEL_ID_FISCAL: Record<string, string> = {
  AR: 'CUIT',
  UY: 'RUT',
  PY: 'RUC',
  CL: 'RUT',
  BR: 'CNPJ / CPF',
};

const PAIS_POR_NOMBRE: Record<string, string> = {
  ARGENTINA: 'AR',
  URUGUAY: 'UY',
  PARAGUAY: 'PY',
  CHILE: 'CL',
  BRASIL: 'BR',
  BRAZIL: 'BR',
};

/**
 * Cómo se llama el ID fiscal en cada país (CUIT, RUT, RUC…), para mensajes al usuario.
 * Acepta el código ("AR") o el nombre ("Argentina", sin importar tildes/mayúsculas).
 * Sin país reconocido, si `idFiscal` es un CUIT argentino válido (11 dígitos + dígito
 * verificador) devuelve "CUIT"; si no, "ID Fiscal". Mismo criterio que `idFiscalPorPais` del front.
 */
export function labelIdFiscalPorPais(
  pais: string | null | undefined,
  idFiscal?: string | null,
): string {
  const v = (pais ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toUpperCase();
  const codigo = PAIS_POR_NOMBRE[v] ?? v;
  const label = LABEL_ID_FISCAL[codigo];
  if (label) return label;
  if (idFiscal && cuitDigitoVerificadorValido(idFiscal)) return LABEL_ID_FISCAL.AR;
  return 'ID Fiscal';
}

export function validarIdFiscal(
  pais: string | null | undefined,
  idFiscal: string | null | undefined,
): void {
  if (!pais || !idFiscal) return;

  if (pais === 'AR') {
    if (!/^[\d-]+$/.test(idFiscal))
      throw new BadRequestException('CUIT/CUIL solo puede contener dígitos y guiones.');
    const d = idFiscal.replace(/-/g, '');
    if (d.length !== 11)
      throw new BadRequestException(`CUIT/CUIL debe tener 11 dígitos (se recibieron ${d.length}).`);
  }

  if (pais === 'UY') {
    if (!/^[\d\s]+$/.test(idFiscal))
      throw new BadRequestException('El RUT solo puede contener dígitos y espacios.');
    const d = idFiscal.replace(/\s/g, '');
    if (d.length !== 12)
      throw new BadRequestException(`RUT debe tener 12 dígitos (se recibieron ${d.length}).`);
  }

  if (pais === 'PY') {
    if (!/^[\d-]+$/.test(idFiscal))
      throw new BadRequestException('El RUC solo puede contener dígitos y guiones.');
    const d = idFiscal.replace(/-/g, '');
    if (d.length < 5 || d.length > 10)
      throw new BadRequestException(`RUC debe tener entre 5 y 10 dígitos (se recibieron ${d.length}).`);
  }

  if (pais === 'CL') {
    const normalized = idFiscal.replace(/[.\s]/g, '').toUpperCase();
    if (!/^\d{7,8}-[\dK]$/.test(normalized))
      throw new BadRequestException('RUT debe tener el formato 12.345.678-9 (7 u 8 dígitos más dígito verificador).');
  }

  if (pais === 'BR') {
    if (!/^[\d./-]+$/.test(idFiscal))
      throw new BadRequestException('El CNPJ/CPF solo puede contener dígitos y separadores (., /, -).');
    const d = idFiscal.replace(/\D/g, '');
    if (d.length !== 11 && d.length !== 14)
      throw new BadRequestException(`CNPJ/CPF debe tener 11 dígitos (CPF) o 14 dígitos (CNPJ) (se recibieron ${d.length}).`);
  }
}

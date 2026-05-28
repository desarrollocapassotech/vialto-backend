import { SetMetadata } from '@nestjs/common';

export const MODULE_KEY = 'required_module';

/** Acepta uno o más módulos: el tenant debe tener AL MENOS UNO de ellos habilitado. */
export const RequireModule = (...moduleNames: string[]) => SetMetadata(MODULE_KEY, moduleNames);

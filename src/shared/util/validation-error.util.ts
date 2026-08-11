import { ValidationError } from "class-validator";

/**
 * Aplana los `ValidationError` de class-validator a un mapa `{ propiedad: mensaje }`
 * (primer mensaje por propiedad), para que el frontend pueda resaltar el campo
 * puntual en vez de mostrar solo un texto genérico. Recorre `children` para DTOs
 * anidados (ej. `otrosGastos[0].monto`) con la ruta separada por puntos.
 */
export function flattenValidationErrors(
  errors: ValidationError[],
  pathPrefix = "",
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const error of errors) {
    const path = pathPrefix ? `${pathPrefix}.${error.property}` : error.property;
    const firstConstraintMessage = error.constraints
      ? Object.values(error.constraints)[0]
      : undefined;
    if (firstConstraintMessage) {
      result[path] = firstConstraintMessage;
    }
    if (error.children?.length) {
      Object.assign(result, flattenValidationErrors(error.children, path));
    }
  }
  return result;
}

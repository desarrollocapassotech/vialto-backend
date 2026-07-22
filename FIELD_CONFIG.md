# Configuración de campos por empresa (Field Config)

## Qué es

Cada empresa cliente de Vialto (Riedel, LSF, NyM, y las que se sumen) usa
solo un subconjunto de los campos disponibles en los formularios del
sistema. Esta feature permite, desde el panel de superadmin, ocultar
campos puntuales por empresa sin necesidad de tocar código ni hacer un
deploy.

Sección en el frontend: **Superadmin → Configuración por empresa**
(`/superadmin/campos-empresa`).

---

## Piezas del sistema

| Pieza | Ubicación | Qué guarda |
|---|---|---|
| Catálogo | `src/core/tenant-field-config/field-catalog.ts` | La lista fija de qué campos existen en cada formulario del sistema, y cuáles son obligatorios — incluyendo obligatoriedad condicional (ver "Antes de marcar un campo como false"). Vive en código. |
| Configuración por tenant | Tabla `tenant_field_configs` (Prisma) | Las excepciones: qué campos oculta cada empresa. Si un campo no aparece acá, se asume visible (default del catálogo). |
| Auditoría | Tabla `tenant_field_config_audit_logs` | Quién cambió qué campo, cuándo, y el valor anterior/nuevo. Append-only. |
| Service | `tenant-field-config.service.ts` | Combina catálogo + overrides para dar el resultado final (qué está visible u oculto) de un formulario o módulo. |
| Endpoints superadmin | `platform.controller.ts` (`/platform/field-config/...`) | Catálogo completo, resultado final por formulario, toggle de un campo. Requieren rol superadmin. |
| Endpoint de negocio | `tenant-field-config.controller.ts` (`/field-config/:modulo`) | El que consulta el frontend real (ej. `ViajeCreatePage.tsx`) para saber qué campos ocultar para el tenant logueado. |

**Regla clave:** solo se guardan excepciones. Si una empresa no tiene fila
en `tenant_field_configs` para un campo, ese campo está visible por
default. Esto evita tener que seedear todos los campos para cada tenant.

**Atajo en el panel de superadmin:** al togglear un campo, hay un
checkbox "Aplicar cambios a todos los formularios del módulo (alta,
edición y detalle)". Si está marcado *antes* de togglear, el cambio se
replica de una sola vez a los 3 formularios del módulo (ej. ocultar
"Otros gastos" en alta, edición y detalle al mismo tiempo). Si no está
marcado, el toggle solo afecta al formulario que se esté viendo en ese
momento.

---

## Cómo agregar un campo nuevo a un formulario existente


Ej: se agrega un campo `numeroContenedor` al alta de viaje.

1. Escribir el campo en el formulario real (`ViajeCreatePage.tsx`), como
   siempre.
2. Abrir `field-catalog.ts` y agregar una entrada al array de campos del
   formulario correspondiente:

   ```ts
   viajes: {
     label: "Viajes",
     formularios: {
       alta_viaje: {
         label: "Alta de viaje",
         campos: [
           // ...campos existentes...
           { campo: "numeroContenedor", label: "Número de contenedor", obligatorioSistema: false },
         ],
       },
     },
   },
   ```

3. En el formulario, envolver el campo con el chequeo de visibilidad
   (ver sección "Cómo consumir la config en un formulario de negocio").
4. Listo. El panel de superadmin ya va a mostrar el toggle nuevo
   automáticamente (no hace falta tocar el frontend del panel — lee el
   catálogo dinámicamente vía `/platform/field-config/catalogo`).

`obligatorioSistema: true` para campos que el negocio necesita sí o sí
(no se pueden ocultar desde el panel, hay validación en el backend que
lo impide).

### Antes de marcar un campo como false

**Regla:** si el campo se vuelve obligatorio en algún escenario del
formulario (un modo, un tipo de operación, otro campo elegido), va como
`obligatorioSistema: true` — aunque a simple vista "parezca" opcional.

Revisá bien las validaciones del formulario (`handleSubmit`, `onContinuar`,
etc.) para chequear si ese campo es obligatorio o no, o si puede llegar a
romper algo en el flujo de carga del formulario.

**Por qué:** Si lo marcás `false` y un superadmin lo oculta, el sistema va a
seguir exigiendo ese dato por detrás — y el usuario queda trabado,
sin poder ver el campo que necesita completar.

---

## Cómo agregar un módulo o formulario nuevo completo

Ej: se suma configurabilidad al módulo Facturación.

1. En `field-catalog.ts`, agregar una entrada nueva al objeto raíz:

   ```ts
   export const FIELD_CATALOG: Record<string, ModuloCatalogo> = {
     viajes: { /* ... */ },
     facturacion: {
       label: "Facturación",
       formularios: {
         alta_factura: {
           label: "Alta de factura",
           campos: [
             { campo: "ivaPct", label: "% IVA", obligatorioSistema: false },
             // ...
           ],
         },
       },
     },
   };
   ```

2. En el frontend de negocio correspondiente (ej. página de alta de
   factura), agregar la consulta al endpoint `/field-config/facturacion`
   y envolver los campos configurables (ver sección siguiente).
3. No hace falta tocar `CamposEmpresaPage.tsx` (el panel de superadmin) —
   los módulos y formularios se listan dinámicamente a partir del
   catálogo.

---

## Cómo consumir la config en un formulario de negocio

El frontend real (usuario a nivel negocio, no el superadmin)
usa el hook `useFieldConfig(modulo)` (`src/hooks/useFieldConfig.ts`). Este
hook hace el fetch a:

```
GET /api/field-config/:modulo
```

(requiere estar logueado; el tenant se toma del JWT, no hace falta
pasarlo) y expone una función `isVisible(formulario, campo)`:

```tsx
import { useFieldConfig } from "@/hooks/useFieldConfig";

const { isVisible } = useFieldConfig("viajes");

{isVisible("alta_viaje", "otrosGastos") && (
  <OtrosGastosFieldset ... />
)}
```

`isVisible` devuelve `true` por default mientras la config todavía está
cargando o si el campo no aparece en la respuesta — así el formulario
nunca queda roto por un fetch lento o fallido; en el peor caso, se
muestra un campo de más, nunca se rompe la pantalla.

Los campos marcados `obligatorioSistema: true` en el catálogo **no se
envuelven** con `isVisible` — siempre se muestran, sin excepción, ya que
no se pueden ocultar desde el panel (hay validación en el backend que lo
impide).

---

## Por qué el valor de cada campo es un objeto y no un boolean

En vez de `{ "otrosGastos": false }`, la config guarda
`{ "otrosGastos": { "visible": false } }`. Es intencional: deja la
estructura lista para sumar a futuro, sin migrar nada, atributos como
`obligatorio`, `labelCustom`, `default`, etc.

---
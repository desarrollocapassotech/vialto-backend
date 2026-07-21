import {
  buildComprobanteCvlp,
  mapCvlpToArcaRequest,
  ConceptoFacturable,
} from "./arca-cvlp.util";
import { ArcaAutorizarRequest } from "./types/arca.types";

describe("arca-cvlp.util", () => {
  const baseCabecera = {
    cuit: "20111111112",
    ptoVenta: 2,
    cbteTipo: 60,
    cbteNro: 1,
    fechaCbte: "20260721",
    concepto: 1,
    docTipo: 80,
    docNro: 30111111118,
    condicionIvaReceptorId: 1,
  };

  it("debería calcular correctamente solo con flete (IVA 21%)", () => {
    const conceptos: ConceptoFacturable[] = [
      { descripcion: "Fletes", importe: 1000 },
      { descripcion: "Comisión", importe: 0 },
    ];

    const cvlp = buildComprobanteCvlp(baseCabecera, conceptos, 21);

    // Verifica totales
    expect(cvlp.impNeto).toBe(1000);
    expect(cvlp.impIva).toBe(210);
    expect(cvlp.impTotal).toBe(1210);

    // Verifica items
    expect(cvlp.items).toHaveLength(1); // Ignora el importe en 0
    expect(cvlp.items[0]).toEqual({
      descripcion: "Fletes",
      importeBase: 1000,
      ivaPct: 21,
      importeIva: 210,
      subtotal: 1210,
    });
  });

  it("debería calcular flete + comisión (IVA 21%) conservando signos", () => {
    const conceptos: ConceptoFacturable[] = [
      { descripcion: "Fletes", importe: 1000 },
      { descripcion: "Comisión", importe: -100 }, // Descuento
    ];

    const cvlp = buildComprobanteCvlp(baseCabecera, conceptos, 21);

    // Totales: 1000 - 100 = 900
    expect(cvlp.impNeto).toBe(900);
    expect(cvlp.impIva).toBe(189); // 900 * 0.21 = 189
    expect(cvlp.impTotal).toBe(1089);

    expect(cvlp.items).toHaveLength(2);

    // Flete
    expect(cvlp.items[0].importeBase).toBe(1000);
    expect(cvlp.items[0].importeIva).toBe(210);
    expect(cvlp.items[0].subtotal).toBe(1210);

    // Comisión
    expect(cvlp.items[1].importeBase).toBe(-100);
    expect(cvlp.items[1].importeIva).toBe(-21);
    expect(cvlp.items[1].subtotal).toBe(-121);

    // Suma de IVAs de items = 210 + (-21) = 189 (No requiere ajuste)
  });

  it("debería calcular flete + comisión + gastos (IVA 10.5%)", () => {
    const conceptos: ConceptoFacturable[] = [
      { descripcion: "Fletes", importe: 2000 },
      { descripcion: "Comisión", importe: -200 },
      { descripcion: "Gastos Administrativos", importe: -50 },
    ];

    const cvlp = buildComprobanteCvlp(baseCabecera, conceptos, 10.5);

    // Totales: 2000 - 200 - 50 = 1750
    expect(cvlp.impNeto).toBe(1750);
    expect(cvlp.impIva).toBe(183.75); // 1750 * 0.105
    expect(cvlp.impTotal).toBe(1933.75);

    expect(cvlp.items).toHaveLength(3);

    // IVA flete = 2000 * 0.105 = 210
    expect(cvlp.items[0].importeIva).toBe(210);

    // IVA comisión = -200 * 0.105 = -21
    expect(cvlp.items[1].importeIva).toBe(-21);

    // IVA gastos = -50 * 0.105 = -5.25
    expect(cvlp.items[2].importeIva).toBe(-5.25);

    // 210 - 21 - 5.25 = 183.75 (Cuadra exacto)
  });

  it("debería inyectar la diferencia de centavos de IVA en la línea mayor (flete)", () => {
    // Escenario que genere 1 centavo de diferencia:
    const conceptos: ConceptoFacturable[] = [
      { descripcion: "Fletes", importe: 200.06 },
      { descripcion: "Comisión", importe: -100.03 },
    ];

    const cvlp = buildComprobanteCvlp(baseCabecera, conceptos, 21);

    // Total neto = 100.03
    // IVA total real = 21.01
    expect(cvlp.impIva).toBe(21.01);

    // IVA de flete sin ajustar = 42.01
    // IVA de comision sin ajustar = -21.01
    // Suma sin ajustar = 21.00
    // Falta 0.01. El flete debe recibir +0.01, quedando en 42.02.
    expect(cvlp.items[0].importeIva).toBe(42.02);
    expect(cvlp.items[1].importeIva).toBe(-21.01);

    // Subtotales ajustados
    expect(cvlp.items[0].subtotal).toBe(242.08); // 200.06 + 42.02
  });

  it("debería permitir totales negativos para anulación de liquidaciones", () => {
    const conceptos: ConceptoFacturable[] = [
      { descripcion: "Fletes", importe: -100 },
      { descripcion: "Comisión", importe: 15 },
    ];

    const cvlp = buildComprobanteCvlp(baseCabecera, conceptos, 21);
    
    expect(cvlp.impNeto).toBe(-85);
    expect(cvlp.impIva).toBe(-17.85);
    expect(cvlp.impTotal).toBe(-102.85);
    expect(cvlp.items[0].importeBase).toBe(-100);
  });

  it("debería calcular correctamente si todos los conceptos son 0", () => {
    const conceptos: ConceptoFacturable[] = [
      { descripcion: "Fletes", importe: 0 },
      { descripcion: "Comisión", importe: 0 },
      { descripcion: "Gastos Administrativos", importe: 0 },
    ];

    const cvlp = buildComprobanteCvlp(baseCabecera, conceptos, 21);

    expect(cvlp.impNeto).toBe(0);
    expect(cvlp.impIva).toBe(0);
    expect(cvlp.impTotal).toBe(0);

    // Todos los items son ignorados porque su importe es 0
    expect(cvlp.items).toHaveLength(0);
  });

  it("debería calcular correctamente con comisión explícita en 0 y gastos en 0", () => {
    const conceptos: ConceptoFacturable[] = [
      { descripcion: "Fletes", importe: 1000 },
      { descripcion: "Comisión", importe: 0 },
      { descripcion: "Gastos Administrativos", importe: 0 },
    ];

    const cvlp = buildComprobanteCvlp(baseCabecera, conceptos, 21);

    expect(cvlp.impNeto).toBe(1000);
    expect(cvlp.impIva).toBe(210);

    // Sólo el flete debe estar presente
    expect(cvlp.items).toHaveLength(1);
    expect(cvlp.items[0].descripcion).toBe("Fletes");
  });

  it("debería eliminar los items y mapear propiedades exactamente en mapCvlpToArcaRequest", () => {
    const conceptos: ConceptoFacturable[] = [
      { descripcion: "Fletes", importe: 1000 },
    ];

    const cvlp = buildComprobanteCvlp(baseCabecera, conceptos, 21);
    const req: ArcaAutorizarRequest = mapCvlpToArcaRequest(cvlp, "homologacion");

    expect((req as any).items).toBeUndefined();
    expect(req.impTotal).toBe(1210);
    expect(req.ambiente).toBe("homologacion");
    expect(req.cuit).toBe("20111111112");
  });
});

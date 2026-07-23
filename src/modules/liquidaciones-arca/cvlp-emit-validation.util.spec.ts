import {
  assertCvlpEmitDatosCompletos,
  collectCvlpEmitMissingFields,
} from './cvlp-emit-validation.util';

function assertThrows(fn: () => void, includes: string) {
  try {
    fn();
    throw new Error(`Expected throw including: ${includes}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes(includes)) {
      throw new Error(`Expected message to include "${includes}", got: ${msg}`);
    }
  }
}

const complete = {
  emisor: {
    cuitEmisor: '30-71234567-8',
    domicilioEmisor: 'Calle 1',
    ingBrutos: '123',
    inicActEmisor: '01/01/2020',
  },
  transportista: {
    domicilio: 'Ruta 9',
    idFiscal: '20-11111111-1',
    condicionIva: 1,
  },
  cliente: {
    nombre: 'Cliente SA',
    direccion: 'Av. Siempre Viva',
    idFiscal: '30-22222222-2',
  },
};

function run() {
  if (collectCvlpEmitMissingFields(complete).length !== 0) {
    throw new Error('complete set should have no missing fields');
  }

  const missing = collectCvlpEmitMissingFields({
    emisor: { cuitEmisor: '30-1', domicilioEmisor: '', ingBrutos: null, inicActEmisor: ' ' },
    transportista: { domicilio: null, idFiscal: '', condicionIva: null },
    cliente: { nombre: '', direccion: null, idFiscal: undefined },
  });
  const expected = [
    'Emisor: domicilio',
    'Emisor: Ingresos Brutos',
    'Emisor: inicio de actividad',
    'Transportista: domicilio',
    'Transportista: CUIT',
    'Transportista: condición de IVA',
    'Cliente: nombre',
    'Cliente: domicilio',
    'Cliente: CUIT',
  ];
  for (const e of expected) {
    if (!missing.includes(e)) throw new Error(`Missing expected item: ${e}`);
  }

  assertThrows(
    () => assertCvlpEmitDatosCompletos({ emisor: null, transportista: null, cliente: null }),
    'No se puede emitir el comprobante',
  );

  assertCvlpEmitDatosCompletos(complete);
  console.log('cvlp-emit-validation.util: ok');
}

run();

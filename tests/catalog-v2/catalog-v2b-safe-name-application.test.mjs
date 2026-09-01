// CATALOG V2B — aplicación segura de los nombres aprobados por el owner:
// 3 previos + 129 del cierre final. El contrato es fail-closed por ID + nombre
// esperado y solo cambia product.name.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPosSandbox, json } from './lib/sandbox.mjs';

const APPROVED = [
  { id: 32, expectedCurrentName: "PAPITA CHIPS X 23 GR", canonicalName: "PAPI CHIPS 23G" },
  { id: 34, expectedCurrentName: "NOSOTRAS INVISIBLES RAPIGEL 10 UND", canonicalName: "NOSOTRAS INVISIBLES RAPIGEL 10UND" },
  { id: 35, expectedCurrentName: "FANNY DELI FRESA 75 GR", canonicalName: "FANNY DELI FRESA 75G" },
  { id: 44, expectedCurrentName: "BOLIVAR AROMA&SUAVIDAD 730G", canonicalName: "DETERGENTE BOLÍVAR RENACIMIENTO AROMA Y SUAVIDAD 730G" },
  { id: 49, expectedCurrentName: "JABON PATITO FLORAL 190GR", canonicalName: "JABÓN PATITO FLORAL 190G" },
  { id: 50, expectedCurrentName: "DETERGENTE BOLIVAR ACTIVE CARNE 140 GR", canonicalName: "DETERGENTE BOLÍVAR ACTIVE CARE 140G" },
  { id: 53, expectedCurrentName: "PATITO LIMON 140G", canonicalName: "DETERGENTE PATITO LIMÓN 140G" },
  { id: 58, expectedCurrentName: "TROME JABON EN PANELA AROMA FLORES 190G", canonicalName: "JABÓN TROME FLORAL 190G" },
  { id: 61, expectedCurrentName: "CLOROX ROPA COLOR 292 ML", canonicalName: "CLOROX ROPA COLOR 292ML" },
  { id: 65, expectedCurrentName: "DET. EN POLVO TROME CÍTRICO X130 G", canonicalName: "DETERGENTE TROME CÍTRICO 130G" },
  { id: 66, expectedCurrentName: "DET. EN POLVO TROME FLORAL X 130 G", canonicalName: "DETERGENTE TROME FLORAL 130G" },
  { id: 69, expectedCurrentName: "DET. EN POLVO OPAL ULTRA X 730G", canonicalName: "DETERGENTE OPAL ULTRA 730G" },
  { id: 70, expectedCurrentName: "PAMPER NINET TALLA L", canonicalName: "PAÑAL NINET TALLA L" },
  { id: 71, expectedCurrentName: "PAÑAL NINET XL 52UND", canonicalName: "PAÑAL NINET TALLA XL" },
  { id: 72, expectedCurrentName: "PAMPER NINET TALLA M", canonicalName: "PAÑAL NINET TALLA M" },
  { id: 73, expectedCurrentName: "HENO DE PRAVIA AMARILLO ORIGINAL 85 GR", canonicalName: "JABÓN HENO DE PRAVIA ORIGINAL AMARILLO 85G" },
  { id: 88, expectedCurrentName: "BOLIVAR SUAV. ARO. ACTIV 80ML", canonicalName: "SUAVIZANTE BOLÍVAR AROMA ACTIVE 80ML" },
  { id: 89, expectedCurrentName: "KOLYNOS SUPER BLANCO 60 ML", canonicalName: "CREMA DENTAL KOLYNOS SUPER BLANCO 60ML" },
  { id: 90, expectedCurrentName: "SHAMPOO SUAVE Y MANEJABLE 2/1 18 ML", canonicalName: "SHAMPOO H&S 2 EN 1 SUAVE Y MANEJABLE 18ML" },
  { id: 91, expectedCurrentName: "SHAMPOO H&S LIMPIEZA RENOVADORA 18 ML", canonicalName: "SHAMPOO H&S LIMPIEZA RENOVADORA 18ML" },
  { id: 93, expectedCurrentName: "CREMA DENTAL COLGATE TRIPLE ACCION 75 ML", canonicalName: "CREMA DENTAL COLGATE TRIPLE ACCIÓN 75ML" },
  { id: 95, expectedCurrentName: "TOKAY ESPIRAL E INSECTICIDA", canonicalName: "ESPIRAL INSECTICIDA TOKAY" },
  { id: 96, expectedCurrentName: "SAPOLIO MATA MOSCAS Y ZANCUDOS", canonicalName: "INSECTICIDA SAPOLIO MATA MOSCAS Y ZANCUDOS 360ML" },
  { id: 98, expectedCurrentName: "SAPOLIO MATACUCARACHAS Y HORMIGAS 360ML", canonicalName: "INSECTICIDA SAPOLIO MATA CUCARACHAS Y HORMIGAS 360ML" },
  { id: 99, expectedCurrentName: "SAPOLIO MATA TODO 360 ML(1-12)", canonicalName: "SAPOLIO CONTROL MATA TODO 360ML" },
  { id: 103, expectedCurrentName: "HAROXA AGUARDIENTE X 250 ML", canonicalName: "AGUARDIENTE HAROXA 250ML" },
  { id: 106, expectedCurrentName: "AGUA SAN LUIS CON GAS BT 625 ML", canonicalName: "AGUA SAN LUIS CON GAS BOTELLA 625ML" },
  { id: 107, expectedCurrentName: "SAN CARLOS S/GAS 500ML", canonicalName: "AGUA SAN CARLOS SIN GAS 500ML" },
  { id: 108, expectedCurrentName: "MALTIN POWER BT 330 ML", canonicalName: "MALTÍN POWER BOTELLA PET 330ML" },
  { id: 109, expectedCurrentName: "LATA MONSTER ENERGY 473 ML", canonicalName: "LATA MONSTER ENERGY 473ML" },
  { id: 110, expectedCurrentName: "LATA MONSTER ENERGY 473 ML", canonicalName: "LATA MONSTER ENERGY 473ML" },
  { id: 113, expectedCurrentName: "CERVEZA CRISTAL LT 355 ML", canonicalName: "CERVEZA CRISTAL LATA 355ML" },
  { id: 115, expectedCurrentName: "CUSQUEÑA DE TRIGO DE BOTELLA 310 ML", canonicalName: "CERVEZA CUSQUEÑA TRIGO BOTELLA 310ML" },
  { id: 116, expectedCurrentName: "ENERGIZANTE VOLT GINSENG (AZUL) 300 ML", canonicalName: "ENERGIZANTE VOLT GINSENG AZUL 300ML" },
  { id: 117, expectedCurrentName: "AGUA SAN CARLOS 3 LT", canonicalName: "AGUA SAN CARLOS 3L" },
  { id: 118, expectedCurrentName: "GASEOSA 3 LITROS IQ AMARILLA", canonicalName: "GASEOSA IQ AMARILLA 3L" },
  { id: 120, expectedCurrentName: "REHIDRANTE SPORADE TROPICAL BOT. PET 500 ML", canonicalName: "REHIDRATANTE SPORADE TROPICAL BOTELLA PET 500ML" },
  { id: 121, expectedCurrentName: "GASEOSA IQ AMARILLA 420 ML", canonicalName: "GASEOSA IQ AMARILLA 420ML" },
  { id: 122, expectedCurrentName: "GASEOSA INCA KOLA 600 ML", canonicalName: "GASEOSA INCA KOLA 600ML" },
  { id: 123, expectedCurrentName: "GASEOSA COCACOLA 600 ML", canonicalName: "GASEOSA COCA-COLA 600ML" },
  { id: 124, expectedCurrentName: "ELECTROLIGHTBEBIDA CON ELECTROLICTOS SABOR A FRESA 475ML", canonicalName: "BEBIDA ELECTROLIGHT FRESA 475ML" },
  { id: 127, expectedCurrentName: "YOFRESH SABOR FRESA 320ML", canonicalName: "YOGUR YOFRESH FRESA 320ML" },
  { id: 131, expectedCurrentName: "JUGO FRUGOS DURAZNO 235 ML", canonicalName: "BEBIDA FRUGOS DURAZNO 235ML" },
  { id: 133, expectedCurrentName: "GOMITAS TRULULU SABORES 90 GR", canonicalName: "TRULULU SABORES 90GR" },
  { id: 136, expectedCurrentName: "GOMITAS TRULULU GUSANOS ÁCIDOS 80 GR", canonicalName: "TRULULU GUSANOS ACIDOS 80GR" },
  { id: 137, expectedCurrentName: "GOMAS TRULULU DINOSS 90G*", canonicalName: "TRULULU DINOS 90GR" },
  { id: 140, expectedCurrentName: "PANETON SAYON 750 GR", canonicalName: "PANETÓN SAYÓN BOLSA 750G" },
  { id: 141, expectedCurrentName: "PANETON MILANO X 750 GR", canonicalName: "PANETÓN MILANO BOLSA 750G" },
  { id: 142, expectedCurrentName: "GASEOSA INCA KOLA 3LT", canonicalName: "GASEOSA INCA KOLA 3L" },
  { id: 143, expectedCurrentName: "GASEOSA COCA COLA 3 LT", canonicalName: "GASEOSA COCA-COLA 3L" },
  { id: 147, expectedCurrentName: "PULP DURAZNO 1 L", canonicalName: "PULP DURAZNO 1L" },
  { id: 148, expectedCurrentName: "JUGO PULP DURAZNO 315 ML", canonicalName: "JUGO PULP DURAZNO 315ML" },
  { id: 150, expectedCurrentName: "CHICHA MORADA UMSHA 13 GR", canonicalName: "REFRESCO UMSHA CHICHA MORADA 13G" },
  { id: 151, expectedCurrentName: "REFRESCO UMSHA MARACUYA", canonicalName: "REFRESCO UMSHA MARACUYÁ 13G" },
  { id: 153, expectedCurrentName: "REFRESCO UMSHA FRESA", canonicalName: "REFRESCO UMSHA FRESA 13G" },
  { id: 154, expectedCurrentName: "BONLÉ MANJARBLANCO 200G", canonicalName: "MANJARBLANCO BONLÉ SACHET 200G" },
  { id: 156, expectedCurrentName: "AVENA 3 OSITOS 100 GR", canonicalName: "AVENA 3 OSITOS CLÁSICA 100G" },
  { id: 160, expectedCurrentName: "NESCAFE KIRMA 9G", canonicalName: "NESCAFÉ KIRMA 9G" },
  { id: 162, expectedCurrentName: "AVENA 3 OSITOS CHOCOLATE 180GR", canonicalName: "AVENA 3 OSITOS CHOCOLATE 180G" },
  { id: 163, expectedCurrentName: "ALTOMAYO 8G", canonicalName: "CAFÉ ALTOMAYO INSTANTÁNEO CLÁSICO 8G" },
  { id: 166, expectedCurrentName: "MAIZENA DURYEA 100 GR", canonicalName: "MAIZENA DURYEA 100G" },
  { id: 167, expectedCurrentName: "ESPIGA DE ORO SPAGHETTI 500G", canonicalName: "SPAGHETTI ESPIGA DE ORO 500G" },
  { id: 169, expectedCurrentName: "SEMOLA MARCO POLO 180GR", canonicalName: "SÉMOLA MARCO POLO 180G" },
  { id: 170, expectedCurrentName: "SALSA CLASICA TOMATE POMAROLA 145 GR", canonicalName: "SALSA DE TOMATE POMAROLA CLÁSICA 145G" },
  { id: 171, expectedCurrentName: "MAYONESA ALACENA 95 GR", canonicalName: "MAYONESA ALACENA 95G" },
  { id: 172, expectedCurrentName: "CREMA AJI TARI ALACENA 85 GR", canonicalName: "CREMA DE AJÍ TARI 85G" },
  { id: 174, expectedCurrentName: "GOLDEN BEACH ROJO", canonicalName: "CIGARRO GOLDEN BEACH ROJO" },
  { id: 178, expectedCurrentName: "FIDEO ESPIGA DE ORO CABELLO DE ANGEL 250GR", canonicalName: "FIDEO ESPIGA DE ORO CABELLO DE ÁNGEL 250G" },
  { id: 179, expectedCurrentName: "LECHE GLORIA EVAPORADA ENTERA EN LATA 170 G", canonicalName: "LECHE GLORIA EVAPORADA ENTERA LATA 170G" },
  { id: 181, expectedCurrentName: "KIKO 85ML", canonicalName: "SILLAO KIKKO 85ML" },
  { id: 184, expectedCurrentName: "SILLAO TITO 85M", canonicalName: "SILLAO TITO 85ML" },
  { id: 186, expectedCurrentName: "LECHE CONDESADA NESTLE 100 GR", canonicalName: "LECHE CONDENSADA NESTLÉ 100G" },
  { id: 187, expectedCurrentName: "LECHE CONDENSADA NESTLE 393G A/F (1-48)", canonicalName: "LECHE CONDENSADA NESTLÉ 393G" },
  { id: 190, expectedCurrentName: "FILETE DE ATUN EN ACEITE VEGETAL DE SOYA PRIMOR 140G", canonicalName: "FILETE DE ATÚN PRIMOR EN ACEITE VEGETAL DE SOYA 140G" },
  { id: 192, expectedCurrentName: "FILETE DE CABALLA D' PACHO", canonicalName: "FILETE DE CABALLA D'PACHO 170G" },
  { id: 195, expectedCurrentName: "GALLETA OREO 36 GR", canonicalName: "GALLETA OREO 36G" },
  { id: 198, expectedCurrentName: "AJINOMOTO AJI-NO-SILLAO 150ML", canonicalName: "AJI-NO-SILLAO 150ML" },
  { id: 200, expectedCurrentName: "CULANTRO FRESH 27 G", canonicalName: "CULANTRITO FRESH 27G" },
  { id: 203, expectedCurrentName: "COMINO Y PIMIENTA 5 GR", canonicalName: "COMINO Y PIMIENTA LOPEZA 5G" },
  { id: 204, expectedCurrentName: "AJI AMARILLO FREHS 27 GR", canonicalName: "AJÍ AMARILLO FRESH 27G" },
  { id: 205, expectedCurrentName: "AJOS FREHS 25 GR", canonicalName: "AJOS FRESH 25G" },
  { id: 209, expectedCurrentName: "GALLETA CASINO VICTORIA FRESA 43 GR", canonicalName: "GALLETA CASINO FRESA 43G" },
  { id: 214, expectedCurrentName: "GALLETA CRACKNEL ORIGINAL 140 GR", canonicalName: "GALLETA CRACKNEL ORIGINAL 140G" },
  { id: 215, expectedCurrentName: "CHOMP NARANJA", canonicalName: "GALLETA CHOMP NARANJA Y CHOCOLATE 38G" },
  { id: 220, expectedCurrentName: "GALLETA CASINO VICTORIA CHOCO 43 GR", canonicalName: "GALLETA CASINO CHOCOLATE 43G" },
  { id: 222, expectedCurrentName: "COSTA POKEKE 28 GR", canonicalName: "BIZCOCHO COSTA POKEKE 28G" },
  { id: 226, expectedCurrentName: "CAFE NESCAFE TRADICION 7G (1-18)(1-12)", canonicalName: "CAFÉ NESCAFÉ TRADICIÓN SACHET 7G" },
  { id: 227, expectedCurrentName: "GALLETA CASINO LÚCUMA 43 GR", canonicalName: "GALLETA CASINO LÚCUMA 43G" },
  { id: 228, expectedCurrentName: "CEREAL ANGEL COPIX 18G (1-12)(1-15)", canonicalName: "CEREAL ÁNGEL COPIX CHOCOLATE 18G" },
  { id: 229, expectedCurrentName: "ANGEL FRESIA ALMOHADA 18G", canonicalName: "CEREAL ÁNGEL FRESIA ALMOHADA 18G" },
  { id: 230, expectedCurrentName: "CEREAL ANGEL CHOCK 20G (1-12)(1-18)", canonicalName: "CEREAL ÁNGEL CHOCK 20G" },
  { id: 241, expectedCurrentName: "GALL VAINILLA FAMILIAR 113 GR", canonicalName: "GALLETA SAYÓN VAINILLA FAMILIAR 113G" },
  { id: 250, expectedCurrentName: "WAFER NIK FRESA 72 GR", canonicalName: "WAFER NIK FRESA 72G" },
  { id: 251, expectedCurrentName: "WAFER NIK CHOCOLATE 72 GR", canonicalName: "WAFER NIK CHOCOLATE 72G" },
  { id: 258, expectedCurrentName: "RELLENAS LIMON 34G", canonicalName: "GALLETA RELLENA DE LIMÓN 34G" },
  { id: 274, expectedCurrentName: "ACEITE MIRASOL 900 ML", canonicalName: "ACEITE MIRASOL 900ML" },
  { id: 275, expectedCurrentName: "ACEITE MIRASOL 900 ML", canonicalName: "ACEITE MIRASOL 900ML" },
  { id: 276, expectedCurrentName: "POLVO DE HORNEAR LA TACNEÑA 25GR", canonicalName: "POLVO DE HORNEAR LA TACNEÑA 25G" },
  { id: 277, expectedCurrentName: "POLVO DE HORNEAR LA TACNEÑA 25GR", canonicalName: "POLVO DE HORNEAR LA TACNEÑA 25G" },
  { id: 280, expectedCurrentName: "ACEITE PRIMOR CLASICO 900 ML", canonicalName: "ACEITE PRIMOR CLÁSICO 900ML" },
  { id: 281, expectedCurrentName: "ACEITE PRIMOR CLASICO 900 ML", canonicalName: "ACEITE PRIMOR CLÁSICO 900ML" },
  { id: 283, expectedCurrentName: "ACEITE PALMEROLA X 900ML", canonicalName: "ACEITE PALMEROLA 900ML" },
  { id: 284, expectedCurrentName: "ACEITE PALMEROLA X 900ML", canonicalName: "ACEITE PALMEROLA 900ML" },
  { id: 297, expectedCurrentName: "PALMEROLA 450 ML", canonicalName: "ACEITE PALMEROLA 450ML" },
  { id: 301, expectedCurrentName: "AZUCAR RUBIA", canonicalName: "AZÚCAR RUBIA" },
  { id: 308, expectedCurrentName: "FIDEOS ESPIGA DE ORO TORNILLO 225GR (1-20)", canonicalName: "FIDEO ESPIGA DE ORO TORNILLO 225G" },
  { id: 318, expectedCurrentName: "MAIZ POP CORN", canonicalName: "MAÍZ POPCORN" },
  { id: 328, expectedCurrentName: "ESCOBESTIA", canonicalName: "ESCOBA ESCOBESTIA HUDE" },
  { id: 331, expectedCurrentName: "CERVEZA CUSQUEÑA NEGRA DARK LAGER BT 310 ML", canonicalName: "CERVEZA CUSQUEÑA NEGRA DARK LAGER BOTELLA 310ML" },
  { id: 333, expectedCurrentName: "CHOCOLATE CUSCO 85 GR", canonicalName: "CHOCOLATE CUSCO TABLETA PARA TAZA 85G" },
  { id: 335, expectedCurrentName: "DOÑA PEPEA FIELD 23G", canonicalName: "GALLETA FIELD DOÑA PEPA 23G" },
  { id: 336, expectedCurrentName: "GASEOSA GUARANÁ 450 ML", canonicalName: "GASEOSA GUARANÁ 450ML" },
  { id: 342, expectedCurrentName: "YOFRESH PET LECHE FRESA 970GR", canonicalName: "YOGUR YOFRESH FRESA BOTELLA PET 970G" },
  { id: 343, expectedCurrentName: "LEJIA SAPOLIO 400GR", canonicalName: "LEJÍA SAPOLIO ORIGINAL 400G" },
  { id: 344, expectedCurrentName: "LEJÍA SAPOLIO 790G", canonicalName: "LEJÍA SAPOLIO ORIGINAL 790G" },
  { id: 345, expectedCurrentName: "GALLETA SAN JORGE SODA FAMILIAR 75 GR", canonicalName: "GALLETA SAN JORGE SODA FAMILIAR 75G" },
  { id: 347, expectedCurrentName: "PAMPER NINET TALLA XL", canonicalName: "PAÑAL NINET TALLA XL" },
  { id: 355, expectedCurrentName: "OKA LOKA NANOS 40G", canonicalName: "OKA LOKA MANOS 40G" },
  { id: 360, expectedCurrentName: "AMBROSOLI CHUPETE QUE LOCO 13G", canonicalName: "CHUPETE AMBROSOLI QUÉ LOCO 13G" },
  { id: 365, expectedCurrentName: "NECTAR GLORIA DURAZNO 145ML TP (1-24)", canonicalName: "NÉCTAR GLORIA DURAZNO 145ML" },
  { id: 367, expectedCurrentName: "PEPSI COLA 600ML", canonicalName: "GASEOSA PEPSI BOTELLA 600ML" },
  { id: 370, expectedCurrentName: "GASEOSA FANTA KOLA INGLESA 500 ML", canonicalName: "GASEOSA FANTA KOLA INGLESA 500ML" },
  { id: 371, expectedCurrentName: "GASEOSA FANTA NARANJA 500 ML", canonicalName: "GASEOSA FANTA NARANJA 500ML" },
  { id: 374, expectedCurrentName: "CHICHARON DE CHANCO 15 GR", canonicalName: "CHICHARRÓN DE CHANCHO 15G" },
  { id: 379, expectedCurrentName: "SUAVIZANTE BOLIVAR AROMA ACTIVO REVIVE COLOR 80ML", canonicalName: "SUAVIZANTE BOLÍVAR AROMA ACTIVE REVIVE COLOR 80ML" },
  { id: 380, expectedCurrentName: "D.T TROME BEBE 130GR", canonicalName: "DETERGENTE TROME BEBÉ 130G" },
  { id: 385, expectedCurrentName: "LECHE EN POLVO GLORIA 96 GR", canonicalName: "LECHE EN POLVO GLORIA SACHET 96G" },
  { id: 387, expectedCurrentName: "CHOCOBUM PACK X 6 UNID", canonicalName: "GALLETA VICTORIA CHOCOBUM PACK 6UND" },
  { id: 388, expectedCurrentName: "VICTORIA CHOCO BUM 33.5 GR", canonicalName: "GALLETA VICTORIA CHOCOBUM 33.5G" },
  { id: 395, expectedCurrentName: "ACEITE COCINERO 900ML (1-12)", canonicalName: "ACEITE COCINERO 900ML" },
  { id: 404, expectedCurrentName: "LECHE GLORIA CONDENSADA 393 GR", canonicalName: "LECHE CONDENSADA GLORIA LATA 393G" },
  { id: 405, expectedCurrentName: "GLORIA BONLÉ SABOR CHOCOLATE 180ML", canonicalName: "CHOCOLATADA GLORIA BONLÉ 180ML" }
];

const PREVIOUSLY_RESOLVED_IDS = new Set([133, 136, 137]);
const FINAL_MISSION_APPLY = APPROVED.filter((entry) => !PREVIOUSLY_RESOLVED_IDS.has(entry.id));
const FINAL_MISSION_KEEP_CURRENT_IDS = [97, 102, 105, 112, 114, 125, 146, 152, 158, 159, 161, 176, 180, 189, 194, 196, 199, 218, 219, 278, 279, 291, 292, 293, 316, 322, 329, 338, 339, 407, 408];

const byId = new Map(APPROVED.map((entry) => [String(entry.id), entry]));
const withoutName = ({ name, ...rest }) => rest;

function settleV1Baseline(sb) {
  sb.run(`
    _naNormalizeData();
    productos=productos.map(p=>p&&typeof p.name==='string'?{...p,name:_naNormCatalogName(p.name)}:p);
  `);
}

function richProduct(entry, index) {
  return {
    id: entry.id,
    name: entry.expectedCurrentName,
    descripcion: `Producto de prueba ${entry.id}`,
    sku: `SAFE-${entry.id}`,
    barcode: `7750000000${index + 1}`,
    codigosAlternativos: [`ALT-${entry.id}`],
    codigoAlternativo: `ALT-${entry.id}`,
    cat: 'snacks',
    icon: '🍬',
    imagen: null,
    costo: 1.54 + index,
    precio: 2.5 + index,
    precioCaja: 30 + index,
    unidCaja: 12,
    stock: 10 + index,
    stockMin: 2,
    venc: '2027-12-31',
    marca: 'Trululu',
    unidad: 'unidad',
    unidadCompra: 'caja',
    factorCompra: 12,
    incluyeIGV: index !== 1,
    tipoImpuesto: index === 1 ? 'exonerado' : 'gravado',
    impuestoComplementario: '',
    controlInventario: true,
  };
}

test('SAFE_ALLOWLIST — aplica exactamente los pares aprobados por ID + expectedCurrentName', () => {
  const sb = createPosSandbox();
  assert.deepEqual(
    json(sb, 'Object.keys(_NA_CATALOG_V2B_SAFE_NAMES).sort()'),
    APPROVED.map((entry) => String(entry.id)).sort()
  );
  for (const entry of APPROVED) {
    assert.equal(
      sb.run(`_naCatalogV2BSafeName(${entry.id},${JSON.stringify(entry.expectedCurrentName)})`),
      entry.canonicalName,
      `ID ${entry.id}`
    );
  }
});

test('FAIL_CLOSED — nombre inesperado, id incorrecto y canónico son no-op', () => {
  const sb = createPosSandbox();
  for (const entry of APPROVED) {
    const unexpected = `NOMBRE MANUAL VERIFICADO ${entry.id}`;
    assert.equal(sb.run(`_naCatalogV2BSafeName(${entry.id},${JSON.stringify(unexpected)})`), unexpected, `mismatch ID ${entry.id}`);
    assert.equal(sb.run(`_naCatalogV2BSafeName(${entry.id},${JSON.stringify(entry.canonicalName)})`), entry.canonicalName, `canónico ID ${entry.id}`);
  }
  assert.equal(sb.run("_naCatalogV2BSafeName(133,'NOMBRE MANUAL VERIFICADO')"), 'NOMBRE MANUAL VERIFICADO');
  assert.equal(sb.run("_naCatalogV2BSafeName(133,'  gomitas trululu sabores 90 gr  ')"), '  gomitas trululu sabores 90 gr  ');
  assert.equal(sb.run("_naCatalogV2BSafeName(999,'GOMITAS TRULULU SABORES 90 GR')"), 'GOMITAS TRULULU SABORES 90 GR');
  assert.equal(sb.run("_naCatalogV2BSafeName(133,'TRULULU SABORES 90GR')"), 'TRULULU SABORES 90GR');

  sb.seed();
  sb.seedData('productos', [richProduct({ ...APPROVED[0], expectedCurrentName: '  gomitas trululu sabores 90 gr  ' }, 0)]);
  sb.run('_naInstallCatalogNameNorm();_naNormalizeData();');
  assert.equal(json(sb, 'productos[0].name'), 'gomitas trululu sabores 90 gr', 'el trim base puede operar, pero V2B no lo convierte en canónico');
  const once = sb.memoryState();
  sb.run('_naNormalizeData()');
  assert.deepEqual(sb.memoryState(), once, 'el mismatch sigue fail-closed en pasadas posteriores');
});

test('FRESH_SEED — el arranque real normaliza los 408 productos y aplica todos los nombres aprobados', async () => {
  const sb = createPosSandbox();
  sb.run('_naInstallCatalogNameNorm()');
  await sb.run('loadAllData()');
  assert.equal(json(sb, 'productos.length'), 408);
  for (const entry of APPROVED) {
    assert.equal(
      sb.run(`productos.find(p=>String(p.id)===${JSON.stringify(String(entry.id))}).name`),
      entry.canonicalName,
      `seed ID ${entry.id}`
    );
  }
});

test('SEARCH_KEYS — el nombre canónico, SKU, barcode principal y alternativo siguen encontrando el producto', () => {
  const sb = createPosSandbox();
  const entry = APPROVED.find((candidate) => candidate.id === 93);
  sb.seed();
  sb.seedData('productos', [richProduct(entry, 0)]);
  sb.run('_naInstallCatalogNameNorm();_naNormalizeData();');

  assert.equal(json(sb, 'productos[0].name'), 'CREMA DENTAL COLGATE TRIPLE ACCIÓN 75ML');
  for (const query of ['triple accion', 'safe-93', '77500000001', 'alt-93']) {
    assert.equal(
      sb.run(`_naProductMatchesVisibleSearch(productos[0],${JSON.stringify(query)},Date.now())`),
      true,
      query
    );
  }
});

test('PERSISTED_SNAPSHOT — loadAllData aplica V2B después de recuperar el snapshot V9', async () => {
  const sb = createPosSandbox();
  sb.seed();
  sb.seedData('productos', APPROVED.map(richProduct));
  sb.seedData('ventas', [{
    id: 'V-SAFE-1', fecha: '2026-08-30', timestamp: '2026-08-30T10:00:00.000Z',
    total: 5, metodo: 'efectivo', items: [{ id: 133, productoId: 133, name: 'NOMBRE HISTÓRICO', nombre: 'NOMBRE HISTÓRICO', qty: 2, cantidad: 2, precio: 2.5, precioUnitario: 2.5, subtotal: 5 }],
  }]);
  sb.seedData('inventoryMovements', [{
    id: 'IM-SAFE-1', productId: 133, type: 'ENTRADA', before: 0, delta: 10, after: 10,
    reason: 'carga inicial', source: 'INVENTORY_MOVE', referenceId: null,
    timestamp: '2026-08-30T09:00:00.000Z', fecha: '2026-08-30',
  }]);
  sb.run('_naNormalizeData()');
  const before = sb.memoryState();
  const persisted = json(sb, '_naBuildSnapshot()');
  sb.stores.localStorage.setItem('na_snapshot_v9', JSON.stringify(persisted));

  sb.seed();
  sb.run('_naInstallCatalogNameNorm()');
  await sb.run('loadAllData()');
  const after = sb.memoryState();

  for (const entry of APPROVED) {
    assert.equal(after.productos.find((p) => String(p.id) === String(entry.id)).name, entry.canonicalName);
  }
  assert.deepEqual(after.ventas, before.ventas, 'historial persistido intacto');
  assert.deepEqual(after.inventoryMovements, before.inventoryMovements, 'ledger persistido intacto');
  for (let i = 0; i < before.productos.length; i++) {
    assert.deepEqual(withoutName(after.productos[i]), withoutName(before.productos[i]), `ID ${before.productos[i].id}: solo name puede cambiar`);
  }
});

test('FINAL_MISSION_CLASSIFICATION — cierra exactamente los 405 IDs en tres estados disjuntos', () => {
  const sb = createPosSandbox();
  settleV1Baseline(sb);
  const scopedIds = json(sb, 'productos.map(p=>p.id)').filter((id) => !PREVIOUSLY_RESOLVED_IDS.has(id));
  const applyIds = new Set(FINAL_MISSION_APPLY.map((entry) => entry.id));
  const keepIds = new Set(FINAL_MISSION_KEEP_CURRENT_IDS);
  const unchangedIds = scopedIds.filter((id) => !applyIds.has(id) && !keepIds.has(id));

  assert.equal(scopedIds.length, 405);
  assert.equal(applyIds.size, 129);
  assert.equal(keepIds.size, 31);
  assert.equal(unchangedIds.length, 245);
  assert.equal([...applyIds].filter((id) => keepIds.has(id)).length, 0);
  assert.equal(applyIds.size + keepIds.size + unchangedIds.length, 405);
});

test('INTEGRITY_408 — cambian 132 names; los otros 276 productos quedan deep-equal', () => {
  const sb = createPosSandbox();
  settleV1Baseline(sb);
  const before = sb.memoryState();
  assert.equal(before.productos.length, 408);
  for (const entry of APPROVED) {
    assert.equal(before.productos.find((p) => String(p.id) === String(entry.id)).name, entry.expectedCurrentName, `before ID ${entry.id}`);
  }

  sb.run('_naInstallCatalogNameNorm();_naNormalizeData();');
  const after = sb.memoryState();
  const changed = after.productos.filter((product, index) => product.name !== before.productos[index].name);
  assert.deepEqual(changed.map((p) => p.id), APPROVED.map((entry) => entry.id));
  assert.equal(changed.length, 132);

  let unchanged = 0;
  for (let i = 0; i < before.productos.length; i++) {
    const prior = before.productos[i];
    const current = after.productos[i];
    const approved = byId.get(String(prior.id));
    assert.equal(current.id, prior.id, `ID estable en índice ${i}`);
    if (approved) {
      assert.equal(current.name, approved.canonicalName, `after ID ${prior.id}`);
      assert.deepEqual(withoutName(current), withoutName(prior), `ID ${prior.id}: solo name difiere`);
    } else {
      assert.deepEqual(current, prior, `ID ${prior.id}: producto completo intacto`);
      unchanged++;
    }
  }
  assert.equal(unchanged, 276);
  assert.deepEqual(after.ventas, before.ventas, 'historial y sus items intactos');
  assert.deepEqual(after.inventoryMovements, before.inventoryMovements, 'ledger intacto');
  assert.deepEqual(after.clientes, before.clientes, 'clientes intactos');
  assert.deepEqual(after.creditos, before.creditos, 'créditos intactos');
  assert.deepEqual(after.gastos, before.gastos, 'gastos intactos');
  assert.deepEqual(after.cajMovs, before.cajMovs, 'caja intacta');
  assert.deepEqual(after.cashClosures, before.cashClosures, 'cierres intactos');
});

test('FIELDS_UNCHANGED — códigos, stock, precio/costo e impuestos permanecen byte-equivalentes', () => {
  const sb = createPosSandbox();
  settleV1Baseline(sb);
  const before = sb.memoryState().productos;
  sb.run('_naInstallCatalogNameNorm();_naNormalizeData();');
  const after = sb.memoryState().productos;
  const protectedFields = [
    'id', 'sku', 'barcode', 'codigosAlternativos', 'codigoAlternativo',
    'stock', 'stockMin', 'precio', 'costo', 'precioCaja',
    'unidad', 'unidadCompra', 'factorCompra', 'marca', 'cat', 'venc',
    'incluyeIGV', 'tipoImpuesto', 'impuestoComplementario',
  ];
  for (const field of protectedFields) {
    assert.deepEqual(after.map((p) => p[field]), before.map((p) => p[field]), field);
  }
});

test('IDEMPOTENT — la segunda pasada completa es no-op', () => {
  const sb = createPosSandbox();
  sb.run('_naInstallCatalogNameNorm();_naNormalizeData();');
  const once = sb.memoryState();
  sb.run('_naNormalizeData()');
  assert.deepEqual(sb.memoryState(), once);
});

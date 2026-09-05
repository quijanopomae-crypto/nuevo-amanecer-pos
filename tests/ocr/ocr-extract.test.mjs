// ocr-extract.test.mjs — contrato aislado del adaptador OCR (WP-04A).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const SOURCE_REL = 'POS/js/ocr/ocr-extract.js';
const SOURCE = readFileSync(path.join(ROOT, SOURCE_REL), 'utf8');

function createSandbox(overrides = {}) {
  class FakeBlob {
    constructor(parts = [], options = {}) {
      this.parts = parts;
      this.type = options.type || '';
    }
  }
  class FakeFile extends FakeBlob {}
  class FakeImage {}
  class FakeImageData {
    constructor(data = new Uint8ClampedArray(4), width = 1, height = 1) {
      this.data = data;
      this.width = width;
      this.height = height;
    }
  }
  const calls = {
    createWorker: 0,
    recognize: 0,
    terminate: 0,
    createElement: 0,
    putImageData: 0,
    storageWrites: 0,
    inventoryWrites: 0,
    persistenceWrites: 0,
    workerOptions: null,
    recognizedInput: null,
  };
  const convertedBlob = new FakeBlob(['png'], { type: 'image/png' });
  const worker = overrides.worker || {
    async recognize(input) {
      calls.recognize += 1;
      calls.recognizedInput = input;
      return { data: { text: 'LECHE 2 4.50\n', confidence: 91.25 } };
    },
    async terminate() { calls.terminate += 1; },
  };
  const engine = overrides.engine === null ? null : (overrides.engine || {
    async createWorker(language, oem, options) {
      calls.createWorker += 1;
      calls.language = language;
      calls.workerOptions = options;
      return worker;
    },
  });
  const storage = {
    getItem() { return null; },
    setItem() { calls.storageWrites += 1; },
    removeItem() { calls.storageWrites += 1; },
  };
  const context = {
    console,
    Blob: FakeBlob,
    File: FakeFile,
    HTMLImageElement: FakeImage,
    ImageData: FakeImageData,
    document: {
      createElement(tag) {
        calls.createElement += 1;
        assert.equal(tag, 'canvas');
        return {
          width: 0,
          height: 0,
          getContext() {
            return {
              putImageData(input, x, y) {
                calls.putImageData += 1;
                calls.putImageDataArgs = [input, x, y];
                if (overrides.putImageDataError) throw overrides.putImageDataError;
              },
            };
          },
          toBlob(callback, type) {
            calls.toBlobType = type;
            callback(overrides.convertedBlob === null ? null : convertedBlob);
          },
        };
      },
    },
    performance: { now: (() => { let value = 10; return () => (value += 5); })() },
    location: { protocol: overrides.protocol || 'http:' },
    Tesseract: engine,
    localStorage: storage,
    sessionStorage: storage,
    applyInventoryMovement() { calls.inventoryWrites += 1; },
    saveAllData() { calls.persistenceWrites += 1; },
  };
  context.window = context;
  const ctx = vm.createContext(context);
  new vm.Script(SOURCE, { filename: SOURCE_REL }).runInContext(ctx);
  return {
    api: vm.runInContext('_NA_OCR_EXTRACT', ctx),
    calls,
    image: new FakeBlob(['image'], { type: 'image/png' }),
    classes: { FakeBlob, FakeFile, FakeImage, FakeImageData },
    plain(value) { return JSON.parse(JSON.stringify(value)); },
  };
}

function assertNoSideEffects(sb) {
  assert.equal(sb.calls.storageWrites, 0);
  assert.equal(sb.calls.inventoryWrites, 0);
  assert.equal(sb.calls.persistenceWrites, 0);
}

test('A01 entrada valida', async () => {
  const sb = createSandbox();
  const result = sb.plain(await sb.api.extractOcrText(sb.image));
  assert.equal(result.ok, true);
  assert.equal(sb.calls.recognize, 1);
});

test('A02 error de formato', async () => {
  const sb = createSandbox();
  const input = new sb.classes.FakeBlob(['x'], { type: 'application/pdf' });
  const result = sb.plain(await sb.api.extractOcrText(input));
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'OCR_INVALID_FORMAT');
  assert.equal(sb.calls.createWorker, 0);
});

test('A03 motor inexistente', async () => {
  const sb = createSandbox({ engine: null });
  const result = sb.plain(await sb.api.extractOcrText(sb.image));
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'OCR_ENGINE_UNAVAILABLE');
});

test('A04 worker falla', async () => {
  const sb = createSandbox({ engine: { async createWorker() { throw new Error('worker bloqueado'); } } });
  const result = sb.plain(await sb.api.extractOcrText(sb.image));
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'OCR_WORKER_INIT_FAILED');
  assert.match(result.error.message, /worker bloqueado/);
});

test('A05 OCR devuelve texto', async () => {
  const sb = createSandbox();
  const result = sb.plain(await sb.api.extractOcrText(sb.image));
  assert.equal(result.rawText, 'LECHE 2 4.50\n');
  assert.equal(result.error, null);
  assert.equal(sb.calls.terminate, 1);
});

test('A06 confidence preservada', async () => {
  const sb = createSandbox();
  const result = sb.plain(await sb.api.extractOcrText(sb.image));
  assert.equal(result.metadata.confidence, 91.25);
});

test('A07 language preservado', async () => {
  const sb = createSandbox();
  const result = sb.plain(await sb.api.extractOcrText(sb.image, { language: 'spa' }));
  assert.equal(result.metadata.language, 'spa');
  assert.equal(sb.calls.language, 'spa');
});

test('A08 durationMs valido', async () => {
  const sb = createSandbox();
  const result = sb.plain(await sb.api.extractOcrText(sb.image));
  assert.equal(typeof result.metadata.durationMs, 'number');
  assert.ok(Number.isFinite(result.metadata.durationMs));
  assert.ok(result.metadata.durationMs >= 0);
});

test('A09 excepcion del motor produce error controlado', async () => {
  const worker = {
    async recognize() { throw new Error('imagen ilegible'); },
    async terminate() {},
  };
  const sb = createSandbox({ worker });
  const result = sb.plain(await sb.api.extractOcrText(sb.image));
  assert.equal(result.ok, false);
  assert.equal(result.rawText, '');
  assert.equal(result.error.code, 'OCR_RECOGNITION_FAILED');
  assert.match(result.error.message, /imagen ilegible/);
});

test('A10 no requiere DOM para Blob', async () => {
  const sb = createSandbox();
  const result = sb.plain(await sb.api.extractOcrText(sb.image));
  assert.equal(result.ok, true);
  assert.equal(sb.calls.createElement, 0);
});

test('A11 no usa localStorage ni sessionStorage', async () => {
  const sb = createSandbox();
  await sb.api.extractOcrText(sb.image);
  assert.equal(sb.calls.storageWrites, 0);
});

test('A12 no modifica inventario', async () => {
  const sb = createSandbox();
  await sb.api.extractOcrText(sb.image);
  assert.equal(sb.calls.inventoryWrites, 0);
});

test('A13 no escribe persistencia', async () => {
  const sb = createSandbox();
  await sb.api.extractOcrText(sb.image);
  assert.equal(sb.calls.persistenceWrites, 0);
});

test('A14 adaptador determinista con motor determinista', async () => {
  const first = createSandbox();
  const second = createSandbox();
  const a = first.plain(await first.api.extractOcrText(first.image));
  const b = second.plain(await second.api.extractOcrText(second.image));
  assert.deepEqual(a, b);
  assertNoSideEffects(first);
  assertNoSideEffects(second);
});

test('A15 no muta la entrada', async () => {
  const sb = createSandbox();
  const before = { type: sb.image.type, parts: sb.image.parts.slice() };
  await sb.api.extractOcrText(sb.image);
  assert.equal(sb.image.type, before.type);
  assert.deepEqual(sb.image.parts, before.parts);
});

test('ImageData se convierte a PNG sin mutar la entrada', async () => {
  const sb = createSandbox();
  const pixels = new Uint8ClampedArray([10, 20, 30, 255]);
  const image = new sb.classes.FakeImageData(pixels, 1, 1);
  const before = Array.from(image.data);
  const result = sb.plain(await sb.api.extractOcrText(image));
  assert.equal(result.ok, true);
  assert.equal(sb.calls.createElement, 1);
  assert.equal(sb.calls.putImageData, 1);
  assert.equal(sb.calls.putImageDataArgs[0], image);
  assert.equal(sb.calls.toBlobType, 'image/png');
  assert.equal(sb.calls.recognizedInput.type, 'image/png');
  assert.deepEqual(Array.from(image.data), before);
});

test('error al convertir ImageData queda controlado', async () => {
  const sb = createSandbox({ convertedBlob: null });
  const image = new sb.classes.FakeImageData();
  const result = sb.plain(await sb.api.extractOcrText(image));
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'OCR_IMAGE_CONVERSION_FAILED');
  assert.equal(sb.calls.createWorker, 0);
  assert.equal(sb.calls.recognize, 0);
});

test('file protocol devuelve indisponibilidad controlada antes del worker', async () => {
  const sb = createSandbox({ protocol: 'file:' });
  const result = sb.plain(await sb.api.extractOcrText(sb.image));
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'OCR_UNAVAILABLE_PROTOCOL');
  assert.equal(sb.calls.createWorker, 0);
});

test('rutas locales explicitas llegan al motor sin fallback', async () => {
  const sb = createSandbox();
  await sb.api.extractOcrText(sb.image);
  assert.deepEqual(sb.plain(sb.calls.workerOptions), {
    workerPath: 'js/ocr/vendor/tesseract-6.0.1/worker.min.js',
    corePath: 'js/ocr/vendor/tesseract-6.0.1/tesseract-core-simd-lstm.wasm.js',
    langPath: 'js/ocr/vendor/tesseract-6.0.1/lang',
    gzip: true,
  });
});

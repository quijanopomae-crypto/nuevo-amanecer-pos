export const MAX_BATCH_ITEMS = 10;
export const MAX_SOURCE_BYTES = 12_000_000;
export const MAX_DATA_URL_LENGTH = 180_000;

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const SAFE_DATA_IMAGE = /^data:image\/(?:png|jpeg|webp|gif);base64,[a-z0-9+/=\s]+$/i;

export function isSafeProductDataImage(value) {
  const source = typeof value === 'string' ? value.trim() : '';
  return SAFE_DATA_IMAGE.test(source) && source.length < MAX_DATA_URL_LENGTH;
}

export function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('Manifest inválido.');
  }
  if (manifest.schema !== 'nuevo-amanecer.lab-product-image-batch/v1') {
    throw new Error('Schema de lote inválido.');
  }
  if (manifest.max_items !== MAX_BATCH_ITEMS) {
    throw new Error('max_items debe ser 10.');
  }
  if (!Array.isArray(manifest.entries) || manifest.entries.length !== MAX_BATCH_ITEMS) {
    throw new Error('El lote debe contener exactamente 10 candidatos.');
  }

  const ids = new Set();
  for (const entry of manifest.entries) {
    if (!entry || typeof entry !== 'object') throw new Error('Entrada de lote inválida.');
    if (!entry.id || ids.has(entry.id)) throw new Error('Cada entrada debe tener id único.');
    ids.add(entry.id);
    if (typeof entry.product_name !== 'string' || !entry.product_name) {
      throw new Error('Cada entrada debe declarar product_name exacto.');
    }
    if (typeof entry.expected_presentation !== 'string' || !entry.expected_presentation) {
      throw new Error('Cada entrada debe declarar expected_presentation.');
    }
    if (entry.action !== 'apply' && entry.action !== 'skip') {
      throw new Error('action debe ser apply o skip.');
    }
    if (entry.action === 'apply') {
      for (const field of ['source_page', 'image_url']) {
        if (typeof entry[field] !== 'string' || !/^https:\/\//i.test(entry[field])) {
          throw new Error(`${field} HTTPS requerido para ${entry.id}.`);
        }
      }
    } else if (typeof entry.reason !== 'string' || !entry.reason) {
      throw new Error(`reason requerido para SKIP ${entry.id}.`);
    }
  }
  return manifest;
}

function withoutImage(product) {
  const copy = { ...product };
  delete copy.imagen;
  return copy;
}

function stableComparable(product) {
  return JSON.stringify(withoutImage(product));
}

function exactMatches(products, productName) {
  return products.filter(product => String(product?.nombre ?? '') === productName);
}

export function applyPreparedEntries(products, manifest, preparedDataUrls = {}) {
  validateManifest(manifest);
  if (!Array.isArray(products)) throw new Error('productos debe ser un array.');

  const baselineLength = products.length;
  const baseline = products.map(product => ({
    product,
    hadOwnImage: Object.prototype.hasOwnProperty.call(product, 'imagen'),
    previousImage: product?.imagen,
    comparable: stableComparable(product)
  }));
  const applied = [];
  const skipped = [];

  const rollback = () => {
    for (const item of baseline) {
      if (item.hadOwnImage) item.product.imagen = item.previousImage;
      else delete item.product.imagen;
    }
  };

  try {
    for (const entry of manifest.entries) {
      if (entry.action === 'skip') {
        skipped.push({ id: entry.id, product_name: entry.product_name, reason: entry.reason });
        continue;
      }

      const matches = exactMatches(products, entry.product_name);
      if (matches.length !== 1) {
        skipped.push({
          id: entry.id,
          product_name: entry.product_name,
          reason: matches.length === 0 ? 'PRODUCT_NOT_FOUND_EXACT' : 'PRODUCT_NAME_AMBIGUOUS'
        });
        continue;
      }

      const dataUrl = preparedDataUrls[entry.id];
      if (!isSafeProductDataImage(dataUrl)) {
        skipped.push({ id: entry.id, product_name: entry.product_name, reason: 'IMAGE_NOT_PREPARED_OR_UNSAFE' });
        continue;
      }

      matches[0].imagen = dataUrl;
      applied.push({ id: entry.id, product_name: entry.product_name });
    }

    if (products.length !== baselineLength) throw new Error('INVARIANT_PRODUCT_COUNT_CHANGED');
    for (let index = 0; index < baseline.length; index += 1) {
      if (baseline[index].product !== products[index]) throw new Error('INVARIANT_PRODUCT_ORDER_CHANGED');
      if (stableComparable(products[index]) !== baseline[index].comparable) {
        throw new Error(`INVARIANT_NON_IMAGE_FIELD_CHANGED:${index}`);
      }
    }
  } catch (error) {
    rollback();
    throw error;
  }

  return { applied, skipped, rollback };
}

function readBlobAsDataUrl(blob, FileReaderCtor) {
  return new Promise((resolve, reject) => {
    const reader = new FileReaderCtor();
    reader.onerror = () => reject(new Error('No se pudo leer la imagen remota.'));
    reader.onload = event => resolve(String(event.target?.result || ''));
    reader.readAsDataURL(blob);
  });
}

function decodeImage(source, ImageCtor) {
  return new Promise((resolve, reject) => {
    const image = new ImageCtor();
    image.onerror = () => reject(new Error('La imagen remota no pudo decodificarse.'));
    image.onload = () => resolve(image);
    image.src = source;
  });
}

export async function optimizeImageBlob(blob, env = globalThis) {
  if (!blob || !ALLOWED_MIME.has(blob.type)) throw new Error('Tipo de imagen no permitido.');
  if (blob.size > MAX_SOURCE_BYTES) throw new Error('La imagen fuente supera 12 MB.');
  if (!env.FileReader || !env.Image || !env.document?.createElement) {
    throw new Error('Entorno gráfico no disponible para optimizar la imagen.');
  }

  const raw = await readBlobAsDataUrl(blob, env.FileReader);
  const decoded = await decodeImage(raw, env.Image);
  let max = 480;
  let quality = 0.72;
  let data = '';

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const scale = Math.min(1, max / Math.max(decoded.width, decoded.height));
    const canvas = env.document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(decoded.width * scale));
    canvas.height = Math.max(1, Math.round(decoded.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D no disponible.');
    context.drawImage(decoded, 0, 0, canvas.width, canvas.height);
    data = canvas.toDataURL('image/jpeg', quality);
    if (data.length < 120_000) break;
    max = Math.round(max * 0.82);
    quality = Math.max(0.48, quality - 0.08);
  }

  if (!isSafeProductDataImage(data)) throw new Error('La imagen optimizada no cumple el límite seguro del POS.');
  return data;
}

export async function prepareRemoteImages(manifest, { fetchFn = globalThis.fetch, optimize = optimizeImageBlob } = {}) {
  validateManifest(manifest);
  if (typeof fetchFn !== 'function') throw new Error('fetch no disponible.');

  const prepared = {};
  const downloads = [];
  for (const entry of manifest.entries) {
    if (entry.action !== 'apply') {
      downloads.push({ id: entry.id, status: 'SKIP', reason: entry.reason });
      continue;
    }
    try {
      const response = await fetchFn(entry.image_url, { mode: 'cors', cache: 'no-store', credentials: 'omit' });
      if (!response?.ok) throw new Error(`HTTP_${response?.status || 'ERROR'}`);
      const blob = await response.blob();
      prepared[entry.id] = await optimize(blob);
      downloads.push({ id: entry.id, status: 'READY' });
    } catch (error) {
      downloads.push({ id: entry.id, status: 'SKIP', reason: String(error?.message || error) });
    }
  }
  return { prepared, downloads };
}

export async function runBatchFromManifest({ products, manifestUrl, fetchFn = globalThis.fetch, optimize = optimizeImageBlob, save }) {
  if (typeof fetchFn !== 'function') throw new Error('fetch no disponible.');
  const manifestResponse = await fetchFn(String(manifestUrl), { cache: 'no-store', credentials: 'same-origin' });
  if (!manifestResponse?.ok) throw new Error(`No se pudo cargar el manifest: HTTP_${manifestResponse?.status || 'ERROR'}`);
  const manifest = validateManifest(await manifestResponse.json());
  const { prepared, downloads } = await prepareRemoteImages(manifest, { fetchFn, optimize });
  const result = applyPreparedEntries(products, manifest, prepared);

  if (result.applied.length && typeof save === 'function') {
    try {
      await save();
    } catch (error) {
      result.rollback();
      throw error;
    }
  }

  return { batch_id: manifest.batch_id, applied: result.applied, skipped: result.skipped, downloads };
}

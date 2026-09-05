/*
 * ocr-extract.js — extraccion OCR de imagenes de compra (V1.1, WP-04A).
 *
 * Responsabilidad unica: convertir una imagen soportada en texto OCR bruto.
 * No parsea productos, no busca coincidencias, no toca inventario, storage,
 * persistencia ni DOM de la aplicacion.
 *
 * Tesseract.js 6.0.1 se carga por separado. Todos sus recursos se resuelven
 * localmente mediante rutas explicitas; nunca se permite fallback a CDN.
 */
(function (root) {
  'use strict';

  var VERSION = '1.0.0';
  var TESSERACT_VERSION = '6.0.1';
  var DEFAULT_LANGUAGE = 'spa';
  var DEFAULT_PATHS = {
    workerPath: 'js/ocr/vendor/tesseract-6.0.1/worker.min.js',
    corePath: 'js/ocr/vendor/tesseract-6.0.1/tesseract-core-simd-lstm.wasm.js',
    langPath: 'js/ocr/vendor/tesseract-6.0.1/lang',
  };

  function nowMs() {
    if (typeof performance !== 'undefined' && performance && typeof performance.now === 'function') {
      return performance.now();
    }
    return Date.now();
  }

  function elapsedMs(startedAt) {
    var elapsed = nowMs() - startedAt;
    return Math.max(0, Math.round(elapsed * 100) / 100);
  }

  function metadata(language, startedAt, confidence) {
    return {
      confidence: typeof confidence === 'number' && isFinite(confidence) ? confidence : null,
      language: language,
      durationMs: elapsedMs(startedAt),
    };
  }

  function failure(code, message, language, startedAt) {
    return {
      ok: false,
      rawText: '',
      metadata: metadata(language, startedAt, null),
      error: { code: code, message: String(message || code) },
    };
  }

  function isBlob(value) {
    return typeof Blob !== 'undefined' && value instanceof Blob;
  }

  function isImageElement(value) {
    return typeof HTMLImageElement !== 'undefined' && value instanceof HTMLImageElement;
  }

  function isImageData(value) {
    return typeof ImageData !== 'undefined' && value instanceof ImageData;
  }

  function validateImage(image) {
    if (isBlob(image)) {
      if (image.type && image.type.indexOf('image/') !== 0) {
        return { code: 'OCR_INVALID_FORMAT', message: 'El Blob/File debe tener un tipo MIME image/*.' };
      }
      return null;
    }
    if (isImageElement(image) || isImageData(image)) return null;
    return {
      code: 'OCR_INVALID_INPUT',
      message: 'Se requiere File, Blob, HTMLImageElement o ImageData.',
    };
  }

  function resolveEngine(options) {
    if (options && options.engine) return options.engine;
    if (root && root.Tesseract) return root.Tesseract;
    return null;
  }

  function resolveProtocol(options) {
    if (options && typeof options.protocol === 'string') return options.protocol;
    if (root && root.location && typeof root.location.protocol === 'string') return root.location.protocol;
    return null;
  }

  function workerOptions(options) {
    var paths = options && options.paths ? options.paths : {};
    return {
      workerPath: paths.workerPath || DEFAULT_PATHS.workerPath,
      corePath: paths.corePath || DEFAULT_PATHS.corePath,
      langPath: paths.langPath || DEFAULT_PATHS.langPath,
      gzip: true,
      logger: options && typeof options.logger === 'function' ? options.logger : function () {},
    };
  }

  function errorMessage(error) {
    if (error && error.message) return error.message;
    return String(error || 'Error OCR desconocido.');
  }

  function imageDataToBlob(image) {
    return new Promise(function (resolve, reject) {
      try {
        if (typeof document === 'undefined' || !document || typeof document.createElement !== 'function') {
          reject(new Error('Canvas no esta disponible para convertir ImageData.'));
          return;
        }
        var canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        var context = canvas.getContext && canvas.getContext('2d');
        if (!context || typeof context.putImageData !== 'function' || typeof canvas.toBlob !== 'function') {
          reject(new Error('Canvas no permite convertir ImageData a PNG.'));
          return;
        }
        context.putImageData(image, 0, 0);
        canvas.toBlob(function (blob) {
          if (blob) resolve(blob);
          else reject(new Error('No se pudo crear el PNG desde ImageData.'));
        }, 'image/png');
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Extrae texto OCR bruto sin interpretar su contenido.
   *
   * @param {File|Blob|HTMLImageElement|ImageData} image imagen que reconoce Tesseract
   * @param {object} [options] configuracion e inyeccion del motor para pruebas
   * @returns {Promise<object>} resultado controlado; nunca rechaza por fallos OCR
   */
  async function extractOcrText(image, options) {
    var settings = options || {};
    var language = typeof settings.language === 'string' && settings.language.trim()
      ? settings.language.trim() : DEFAULT_LANGUAGE;
    var startedAt = nowMs();
    var inputError = validateImage(image);
    if (inputError) return failure(inputError.code, inputError.message, language, startedAt);

    if (resolveProtocol(settings) === 'file:') {
      return failure(
        'OCR_UNAVAILABLE_PROTOCOL',
        'OCR no esta disponible bajo file:// porque Worker/WASM requiere un origen HTTP.',
        language,
        startedAt
      );
    }

    var normalizedImage = image;
    if (isImageData(image)) {
      try {
        normalizedImage = await imageDataToBlob(image);
      } catch (error) {
        return failure('OCR_IMAGE_CONVERSION_FAILED', errorMessage(error), language, startedAt);
      }
    }

    var engine = resolveEngine(settings);
    if (!engine || typeof engine.createWorker !== 'function') {
      return failure(
        'OCR_ENGINE_UNAVAILABLE',
        'Tesseract.js 6.0.1 no esta cargado localmente.',
        language,
        startedAt
      );
    }

    var worker = null;
    try {
      worker = await engine.createWorker(language, undefined, workerOptions(settings));
    } catch (error) {
      return failure('OCR_WORKER_INIT_FAILED', errorMessage(error), language, startedAt);
    }

    try {
      var recognized = await worker.recognize(normalizedImage);
      var data = recognized && recognized.data ? recognized.data : {};
      return {
        ok: true,
        rawText: typeof data.text === 'string' ? data.text : '',
        metadata: metadata(language, startedAt, data.confidence),
        error: null,
      };
    } catch (error) {
      return failure('OCR_RECOGNITION_FAILED', errorMessage(error), language, startedAt);
    } finally {
      if (worker && typeof worker.terminate === 'function') {
        try { await worker.terminate(); } catch (ignored) { /* resultado OCR ya esta cerrado */ }
      }
    }
  }

  var api = {
    version: VERSION,
    tesseractVersion: TESSERACT_VERSION,
    defaultLanguage: DEFAULT_LANGUAGE,
    defaultPaths: DEFAULT_PATHS,
    extractOcrText: extractOcrText,
  };

  if (root) {
    root._NA_OCR_EXTRACT = api;
    root.extractOcrText = extractOcrText;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

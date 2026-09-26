(function (root) {
  'use strict';

  var HOSTED_POS_HOST = 'nuevo-amanecer-pos-web.nuevo-amanecer-pos.workers.dev';
  var CANON_API = 'https://nuevo-amanecer-pos-prod.nuevo-amanecer-pos.workers.dev';
  var BINDING_KEY = 'na_canonical_binding';
  var CREDENTIALS_KEY = 'na_cloud_sync_credentials';

  if (!root.location || root.location.hostname !== HOSTED_POS_HOST) return;

  function readJson(key) {
    try { return JSON.parse(root.localStorage.getItem(key) || 'null'); }
    catch (_) { return null; }
  }

  function validBinding(value) {
    return !!(value && typeof value === 'object' && !Array.isArray(value) &&
      value.endpoint === CANON_API &&
      typeof value.promotion_id === 'string' && value.promotion_id.length > 0 &&
      Number.isSafeInteger(value.authority_epoch) && value.authority_epoch >= 0 &&
      Number.isSafeInteger(value.revision) && value.revision >= 0);
  }

  function validCredentials(value) {
    return !!(value && typeof value === 'object' && !Array.isArray(value) &&
      value.endpoint === CANON_API &&
      typeof value.token === 'string' && value.token.length > 0 && value.token.length <= 2048 &&
      !/[\r\n]/.test(value.token));
  }

  var binding = readJson(BINDING_KEY);
  var credentials = readJson(CREDENTIALS_KEY);
  if (validBinding(binding) && validCredentials(credentials)) {
    root.document.documentElement.dataset.naHostedCanon = 'bound';
    return;
  }

  root.document.documentElement.dataset.naHostedCanon = 'activation-required';
  if (/^\/app(?:\/|$)/.test(root.location.pathname)) {
    root.location.replace(root.location.origin + '/');
  }
})(window);

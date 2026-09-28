(function (root) {
  'use strict';

  var HOSTED_SUFFIX = '.nuevo-amanecer-pos.workers.dev';
  var BINDING_KEY = 'na_canonical_binding';
  var CREDENTIALS_KEY = 'na_cloud_sync_credentials';
  var config = root.NA_HOSTED_CONFIG || null;
  var isHosted = !!(root.location && root.location.hostname.endsWith(HOSTED_SUFFIX));

  if (!isHosted) return;

  function validConfig(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        !['production', 'staging'].includes(value.environment) ||
        value.hostedHost !== root.location.hostname ||
        typeof value.apiOrigin !== 'string') return false;
    try {
      var url = new URL(value.apiOrigin);
      return url.protocol === 'https:' && url.origin === value.apiOrigin &&
        !url.username && !url.password && !url.search && !url.hash;
    } catch (_) {
      return false;
    }
  }

  if (!validConfig(config)) {
    root.document.documentElement.dataset.naHostedCanon = 'config-error';
    if (/^\/app(?:\/|$)/.test(root.location.pathname)) root.location.replace(root.location.origin + '/');
    return;
  }

  var CANON_API = config.apiOrigin;

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
    root.document.documentElement.dataset.naHostedEnvironment = config.environment;
    return;
  }

  root.document.documentElement.dataset.naHostedCanon = 'activation-required';
  if (/^\/app(?:\/|$)/.test(root.location.pathname)) {
    root.location.replace(root.location.origin + '/');
  }
})(window);

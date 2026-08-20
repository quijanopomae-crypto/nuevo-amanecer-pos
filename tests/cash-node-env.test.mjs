import { test } from 'node:test';

test('entorno node', () => {
  console.log('NODE_VERSION=' + process.version);
  console.log('HAS_WEBSOCKET=' + (typeof WebSocket));
  console.log('HAS_FETCH=' + (typeof fetch));
});

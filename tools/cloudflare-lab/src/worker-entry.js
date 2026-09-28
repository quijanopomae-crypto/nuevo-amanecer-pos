import worker from './worker.js';
import { normalizeDatabaseBinding } from './database-binding.js';

export default {
  fetch(request, env, context) {
    return worker.fetch(request, normalizeDatabaseBinding(env), context);
  },
};

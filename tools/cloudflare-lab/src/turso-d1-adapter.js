const TURSO_PROTOCOL_PATH = '/v3/pipeline';

function normalizeBaseUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('TURSO_DATABASE_URL is required when DB_PROVIDER=turso');
  let url;
  if (raw.startsWith('libsql://')) url = new URL('https://' + raw.slice('libsql://'.length));
  else url = new URL(raw);
  if (url.protocol !== 'https:') throw new Error('TURSO_DATABASE_URL must use libsql:// or https://');
  url.pathname = url.pathname.replace(/\/+$/, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function encodeBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=+$/, '');
}

function decodeBase64(value) {
  const padded = String(value || '') + '='.repeat((4 - String(value || '').length % 4) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function encodeValue(value) {
  if (value === null) return { type:'null' };
  if (typeof value === 'string') return { type:'text', value };
  if (typeof value === 'boolean') return { type:'integer', value:value ? '1' : '0' };
  if (typeof value === 'bigint') return { type:'integer', value:String(value) };
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Turso bind values must be finite numbers');
    if (Number.isSafeInteger(value)) return { type:'integer', value:String(value) };
    return { type:'float', value };
  }
  if (value instanceof Uint8Array) return { type:'blob', base64:encodeBase64(value) };
  if (value instanceof ArrayBuffer) return { type:'blob', base64:encodeBase64(new Uint8Array(value)) };
  throw new TypeError('Unsupported Turso bind value: ' + typeof value);
}

function decodeInteger(value) {
  const bigint = BigInt(value);
  if (bigint >= BigInt(Number.MIN_SAFE_INTEGER) && bigint <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(bigint);
  return String(value);
}

function decodeValue(value) {
  if (!value || value.type === 'null') return null;
  if (value.type === 'text') return value.value;
  if (value.type === 'integer') return decodeInteger(value.value);
  if (value.type === 'float') return value.value === null ? Number.NaN : Number(value.value);
  if (value.type === 'blob') return decodeBase64(value.base64);
  throw new Error('Unsupported Turso result value type: ' + String(value.type));
}

function mapRows(result) {
  const columns = (result?.cols || []).map((column, index) => column?.name || 'column_' + index);
  return (result?.rows || []).map((values) => {
    const row = {};
    for (let i = 0; i < columns.length; i += 1) row[columns[i]] = decodeValue(values[i]);
    return row;
  });
}

function mapMeta(result) {
  const direct = Number(result?.affected_row_count || 0);
  const written = Number(result?.rows_written ?? direct);
  return {
    duration: Number(result?.query_duration_ms || 0),
    changes: Number.isSafeInteger(written) ? written : direct,
    last_row_id: result?.last_insert_rowid == null ? null : decodeInteger(result.last_insert_rowid),
    rows_read: Number(result?.rows_read || 0),
    rows_written: Number(result?.rows_written || 0),
  };
}

function mapD1Result(result) {
  return {
    success:true,
    results:mapRows(result),
    meta:mapMeta(result),
  };
}

function protocolError(error, prefix = 'Turso SQL error') {
  const message = String(error?.message || error?.error || 'unknown error');
  const out = new Error(prefix + ': ' + message);
  if (error?.code) out.code = error.code;
  if (error?.extended_code) out.extendedCode = error.extended_code;
  return out;
}

class TursoPreparedStatement {
  constructor(database, sql, args = []) {
    this.database = database;
    this.sql = String(sql);
    this.args = args;
  }

  bind(...args) {
    return new TursoPreparedStatement(this.database, this.sql, args);
  }

  _protocolStatement(wantRows = true) {
    return {
      sql:this.sql,
      args:this.args.map(encodeValue),
      want_rows:wantRows,
    };
  }

  async first() {
    const out = await this.database._execute(this, true);
    return out.results[0] ?? null;
  }

  async all() {
    return this.database._execute(this, true);
  }

  async run() {
    const out = await this.database._execute(this, false);
    return { success:true, meta:out.meta };
  }
}

export class TursoD1Adapter {
  constructor({ url, authToken, fetchImpl = globalThis.fetch }) {
    if (typeof fetchImpl !== 'function') throw new Error('fetch is required for Turso');
    this.baseUrl = normalizeBaseUrl(url);
    this.authToken = String(authToken || '').trim();
    if (!this.authToken) throw new Error('TURSO_AUTH_TOKEN is required when DB_PROVIDER=turso');
    this.fetchImpl = fetchImpl;
  }

  prepare(sql) {
    return new TursoPreparedStatement(this, sql);
  }

  async _pipeline(requests) {
    const response = await this.fetchImpl(this.baseUrl + TURSO_PROTOCOL_PATH, {
      method:'POST',
      headers:{
        'authorization':'Bearer ' + this.authToken,
        'content-type':'application/json',
      },
      body:JSON.stringify({ baton:null, requests }),
    });
    let body;
    try { body = await response.json(); } catch {
      throw new Error('Turso protocol returned non-JSON HTTP ' + response.status);
    }
    if (!response.ok) throw protocolError(body, 'Turso HTTP ' + response.status);
    return body;
  }

  async _execute(statement, wantRows) {
    const body = await this._pipeline([
      { type:'execute', stmt:statement._protocolStatement(wantRows) },
      { type:'close' },
    ]);
    const first = body?.results?.[0];
    if (!first || first.type !== 'ok' || first.response?.type !== 'execute') {
      throw protocolError(first?.error || { message:'missing execute result' });
    }
    return mapD1Result(first.response.result);
  }

  async batch(statements) {
    if (!Array.isArray(statements)) throw new TypeError('db.batch expects an array');
    if (!statements.length) return [];
    for (const statement of statements) {
      if (!(statement instanceof TursoPreparedStatement) || statement.database !== this) {
        throw new TypeError('db.batch only accepts statements prepared by the same Turso adapter');
      }
    }

    const steps = [{ stmt:{ sql:'BEGIN IMMEDIATE', want_rows:false } }];
    for (let i = 0; i < statements.length; i += 1) {
      steps.push({
        condition:{ type:'ok', step:i },
        stmt:statements[i]._protocolStatement(true),
      });
    }
    const commitStep = steps.length;
    steps.push({
      condition:{ type:'ok', step:commitStep - 1 },
      stmt:{ sql:'COMMIT', want_rows:false },
    });
    steps.push({
      condition:{ type:'not', cond:{ type:'ok', step:commitStep } },
      stmt:{ sql:'ROLLBACK', want_rows:false },
    });

    const body = await this._pipeline([
      { type:'batch', batch:{ steps } },
      { type:'close' },
    ]);
    const first = body?.results?.[0];
    if (!first || first.type !== 'ok' || first.response?.type !== 'batch') {
      throw protocolError(first?.error || { message:'missing batch result' });
    }
    const batch = first.response.result || {};
    const errors = batch.step_errors || [];
    const beginError = errors[0];
    if (beginError) throw protocolError(beginError, 'Turso BEGIN failed');

    for (let i = 0; i < statements.length; i += 1) {
      const error = errors[i + 1];
      if (error) throw protocolError(error);
      if (!batch.step_results?.[i + 1]) {
        throw new Error('Turso batch skipped statement ' + i);
      }
    }
    if (errors[commitStep]) throw protocolError(errors[commitStep], 'Turso COMMIT failed');
    if (!batch.step_results?.[commitStep]) throw new Error('Turso batch did not commit');

    return statements.map((_, index) => mapD1Result(batch.step_results[index + 1]));
  }
}

export function createTursoD1Adapter(env, options = {}) {
  return new TursoD1Adapter({
    url:env?.TURSO_DATABASE_URL,
    authToken:env?.TURSO_AUTH_TOKEN,
    fetchImpl:options.fetchImpl || globalThis.fetch,
  });
}

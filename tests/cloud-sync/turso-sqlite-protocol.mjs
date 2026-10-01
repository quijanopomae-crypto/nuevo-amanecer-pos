// Test-only Hrana v3 transport. Executes real SQLite statements/transactions;
// the production TursoD1Adapter still serializes, decodes and checks every result.
import { TursoD1Adapter } from '../../tools/cloudflare-lab/src/turso-d1-adapter.js';

export function tursoSqlite(database) {
  const calls = [];
  const decode = v => v.type === 'null' ? null : v.type === 'integer' ? Number(v.value) : v.value;
  const encode = v => v == null ? {type:'null'} : typeof v === 'number'
    ? (Number.isSafeInteger(v) ? {type:'integer',value:String(v)} : {type:'float',value:v})
    : {type:'text',value:String(v)};
  function execute(stmt) {
    const query = database.prepare(stmt.sql), args = (stmt.args || []).map(decode);
    const cols = query.columns().map(c => ({name:c.name}));
    if (cols.length) {
      const rows = query.all(...args);
      return {cols,rows:rows.map(row => cols.map(c => encode(row[c.name]))),affected_row_count:0,last_insert_rowid:null};
    }
    const result = query.run(...args);
    return {cols:[],rows:[],affected_row_count:Number(result.changes),last_insert_rowid:String(result.lastInsertRowid)};
  }
  function condition(c, results) {
    if (!c) return true;
    if (c.type === 'ok') return results[c.step] != null;
    if (c.type === 'not') return !condition(c.cond, results);
    throw Error('Unsupported test protocol condition');
  }
  const adapter = new TursoD1Adapter({url:'https://synthetic.turso.test',authToken:'synthetic-only',fetchImpl:async (_url, init) => {
    const body = JSON.parse(init.body); calls.push(body);
    const results = body.requests.map(request => {
      try {
        if (request.type === 'close') return {type:'ok',response:{type:'close'}};
        if (request.type === 'execute') return {type:'ok',response:{type:'execute',result:execute(request.stmt)}};
        if (request.type !== 'batch') throw Error('Unsupported test request');
        const step_results=[],step_errors=[];
        for (const step of request.batch.steps) {
          if (!condition(step.condition, step_results)) { step_results.push(null); step_errors.push(null); continue; }
          try { step_results.push(execute(step.stmt)); step_errors.push(null); }
          catch (e) { step_results.push(null); step_errors.push({message:e.message,code:'SQLITE_ERROR'}); }
        }
        return {type:'ok',response:{type:'batch',result:{step_results,step_errors}}};
      } catch (e) { return {type:'error',error:{message:e.message,code:'SQLITE_ERROR'}}; }
    });
    return Response.json({results});
  }});
  return {adapter,calls};
}

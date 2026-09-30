import test from 'node:test';
import assert from 'node:assert/strict';
import { TursoD1Adapter, createTursoD1Adapter } from '../src/turso-d1-adapter.js';
import { getDatabase, normalizeDatabaseBinding } from '../src/database-binding.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers:{'content-type':'application/json'}
  });
}

test('first/all map Turso protocol rows to the D1-style contract', async () => {
  const calls=[];
  const db=new TursoD1Adapter({
    url:'libsql://lab-example.turso.io',
    authToken:'test-token',
    fetchImpl:async (url, init) => {
      calls.push({url,init,body:JSON.parse(init.body)});
      return jsonResponse({
        baton:null,
        base_url:null,
        results:[
          {type:'ok',response:{type:'execute',result:{
            cols:[{name:'id'},{name:'name'}],
            rows:[
              [{type:'integer',value:'1'},{type:'text',value:'Ana'}],
              [{type:'integer',value:'2'},{type:'text',value:'Luis'}]
            ],
            affected_row_count:0,last_insert_rowid:null,rows_read:2,rows_written:0,query_duration_ms:1.25
          }}},
          {type:'ok',response:{type:'close'}}
        ]
      });
    }
  });
  const first=await db.prepare('SELECT id,name FROM customers WHERE active=?1').bind(1).first();
  assert.deepEqual(first,{id:1,name:'Ana'});
  const all=await db.prepare('SELECT id,name FROM customers').all();
  assert.equal(all.success,true);
  assert.equal(all.results.length,2);
  assert.equal(all.meta.rows_read,2);
  assert.match(calls[0].url,/^https:\/\/lab-example\.turso\.io\/v3\/pipeline$/);
  assert.equal(calls[0].body.requests[0].stmt.args[0].value,'1');
  assert.equal(calls[0].init.headers.authorization,'Bearer test-token');
});

test('run maps rows_written to D1 meta.changes', async () => {
  const db=new TursoD1Adapter({
    url:'https://lab-example.turso.io',
    authToken:'test-token',
    fetchImpl:async () => jsonResponse({
      results:[
        {type:'ok',response:{type:'execute',result:{
          cols:[],rows:[],affected_row_count:1,last_insert_rowid:'7',
          rows_read:1,rows_written:3,query_duration_ms:0.5
        }}},
        {type:'ok',response:{type:'close'}}
      ]
    })
  });
  const result=await db.prepare('UPDATE x SET y=?1 WHERE id=?2').bind('v',7).run();
  assert.equal(result.meta.changes,3);
  assert.equal(result.meta.last_row_id,7);
});

test('batch creates an all-or-nothing transaction with conditional rollback', async () => {
  let payload;
  const db=new TursoD1Adapter({
    url:'libsql://lab-example.turso.io',
    authToken:'test-token',
    fetchImpl:async (_url, init) => {
      payload=JSON.parse(init.body);
      return jsonResponse({
        results:[
          {type:'ok',response:{type:'batch',result:{
            step_results:[
              {cols:[],rows:[],affected_row_count:0,rows_read:0,rows_written:0},
              {cols:[],rows:[],affected_row_count:1,rows_read:0,rows_written:1},
              {cols:[],rows:[],affected_row_count:1,rows_read:0,rows_written:2},
              {cols:[],rows:[],affected_row_count:0,rows_read:0,rows_written:0},
              null
            ],
            step_errors:[null,null,null,null,null]
          }}},
          {type:'ok',response:{type:'close'}}
        ]
      });
    }
  });
  const a=db.prepare('INSERT INTO a VALUES(?1)').bind(1);
  const b=db.prepare('UPDATE b SET n=n+1 WHERE id=?1').bind(2);
  const out=await db.batch([a,b]);
  assert.equal(out.length,2);
  assert.equal(out[0].meta.changes,1);
  assert.equal(out[1].meta.changes,2);
  const steps=payload.requests[0].batch.steps;
  assert.equal(steps[0].stmt.sql,'BEGIN IMMEDIATE');
  assert.deepEqual(steps[1].condition,{type:'ok',step:0});
  assert.deepEqual(steps[2].condition,{type:'ok',step:1});
  assert.equal(steps[3].stmt.sql,'COMMIT');
  assert.equal(steps[4].stmt.sql,'ROLLBACK');
  assert.deepEqual(steps[4].condition,{type:'not',cond:{type:'ok',step:3}});
});

test('batch surfaces SQL errors instead of committing partial writes', async () => {
  const db=new TursoD1Adapter({
    url:'libsql://lab-example.turso.io',
    authToken:'test-token',
    fetchImpl:async () => jsonResponse({
      results:[
        {type:'ok',response:{type:'batch',result:{
          step_results:[
            {cols:[],rows:[],affected_row_count:0},
            null,
            null,
            null
          ],
          step_errors:[
            null,
            {message:'CHECK constraint failed: ok = 1',code:'SQLITE_CONSTRAINT',extended_code:'SQLITE_CONSTRAINT_CHECK'},
            null,
            null
          ]
        }}},
        {type:'ok',response:{type:'close'}}
      ]
    })
  });
  await assert.rejects(
    db.batch([db.prepare('INSERT INTO canonical_assertions VALUES(1,0)')]),
    /CHECK constraint failed: ok = 1/
  );
});

test('database binding remains D1 by default and selects Turso only explicitly', () => {
  const d1={prepare(){}};
  assert.equal(getDatabase({DB:d1}),d1);
  const env={
    DB_PROVIDER:'turso',
    TURSO_DATABASE_URL:'libsql://lab-example.turso.io',
    TURSO_AUTH_TOKEN:'token'
  };
  const db=getDatabase(env);
  assert.ok(db instanceof TursoD1Adapter);
  assert.equal(normalizeDatabaseBinding(env).DB,db);
  assert.throws(
    () => createTursoD1Adapter({TURSO_DATABASE_URL:'libsql://lab-example.turso.io'}),
    /TURSO_AUTH_TOKEN/
  );
});


test('fetch implementation is bound to globalThis for Cloudflare Worker compatibility', async () => {
  let observedThis = null;
  async function receiverSensitiveFetch() {
    observedThis = this;
    return jsonResponse({
      results:[
        {type:'ok',response:{type:'execute',result:{
          cols:[{name:'ok'}],
          rows:[[{type:'integer',value:'1'}]],
          affected_row_count:0,rows_read:1,rows_written:0
        }}},
        {type:'ok',response:{type:'close'}}
      ]
    });
  }

  const db=new TursoD1Adapter({
    url:'libsql://lab-example.turso.io',
    authToken:'test-token',
    fetchImpl:receiverSensitiveFetch
  });
  const row=await db.prepare('SELECT 1 AS ok').first();
  assert.deepEqual(row,{ok:1});
  assert.equal(observedThis,globalThis);
});

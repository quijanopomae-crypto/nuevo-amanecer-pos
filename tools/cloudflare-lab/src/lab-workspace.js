const WORKSPACE_ID = 'primary';
const SHA256_HEX = /^[0-9a-f]{64}$/;
const MAX_SNAPSHOT_BYTES = 10 * 1024 * 1024;
const BACKUP_FORMAT = 'nuevo-amanecer-pos-backup';

export function isLabWorkspacePath(pathname) {
  return pathname === '/lab/workspace' ||
    pathname === '/lab/workspace/status' ||
    pathname === '/lab/workspace/save' ||
    pathname === '/lab/workspace/reset' ||
    pathname === '/lab/workspace/import-baseline' ||
    pathname === '/lab/workspace/refresh-from-canon';
}

export async function handleLabWorkspace(request, url, env, deps) {
  const { jsonLab, authorizeRead, authorizeDevice } = deps;
  const db = env.nuevo_amanecer_lab;
  if (!db) return jsonLab({ error: 'lab_database_missing' }, 503);

  if (request.method === 'GET' && (url.pathname === '/lab/workspace' || url.pathname === '/lab/workspace/status')) {
    const hasReadToken = !!request.headers.get('x-read-token');
    if (hasReadToken) {
      const denied = authorizeRead(request, env);
      if (denied) return jsonLab({ error: 'unauthorized' }, denied.status || 401);
    } else {
      const auth = await authorizeDevice(request.headers.get('x-device-id'), request, env, false);
      if (auth instanceof Response) {
        let body = { error: 'unauthorized' };
        try { body = await auth.clone().json(); } catch {}
        return jsonLab(body, auth.status || 401);
      }
    }
    return readWorkspace(db, jsonLab, url.pathname === '/lab/workspace/status');
  }

  if (request.method !== 'POST') {
    return jsonLab({ error: 'method_not_allowed' }, 405, { allow: 'GET, POST, OPTIONS' });
  }

  if (url.pathname === '/lab/workspace/import-baseline') {
    const body = await readJsonBody(request, jsonLab);
    if (body instanceof Response) return body;
    return importBaseline(db, env, request, body, jsonLab);
  }

  const auth = await authorizeDevice(request.headers.get('x-device-id'), request, env, true);
  if (auth instanceof Response) {
    let body = { error: 'unauthorized' };
    try { body = await auth.clone().json(); } catch {}
    return jsonLab(body, auth.status || 401);
  }
  const deviceId = request.headers.get('x-device-id');

  if (url.pathname === '/lab/workspace/save') {
    const body = await readJsonBody(request, jsonLab);
    if (body instanceof Response) return body;
    return saveWorkspace(db, body, deviceId, jsonLab);
  }
  if (url.pathname === '/lab/workspace/reset') {
    const body = await readJsonBody(request, jsonLab, true);
    if (body instanceof Response) return body;
    return resetWorkspace(db, body, deviceId, jsonLab);
  }
  if (url.pathname === '/lab/workspace/refresh-from-canon') {
    return jsonLab({
      error: 'refresh_pipeline_required',
      message: 'CANON usa backups SQL + manifest. Ejecuta el workflow Refresh LAB Data desde GitHub Actions.'
    }, 409);
  }
  return jsonLab({ error: 'not_found' }, 404);
}

async function readJsonBody(request, jsonLab, optional = false) {
  const text = await request.text();
  if (!text && optional) return {};
  if (!text) return jsonLab({ error: 'body_required' }, 400);
  if (new TextEncoder().encode(text).length > MAX_SNAPSHOT_BYTES + 100_000) {
    return jsonLab({ error: 'payload_too_large' }, 413);
  }
  try {
    return JSON.parse(text);
  } catch {
    return jsonLab({ error: 'invalid_json' }, 400);
  }
}

async function readWorkspace(db, jsonLab, statusOnly) {
  const control = await db.prepare(
    `SELECT c.workspace_id, c.active_revision, c.active_baseline_id, c.updated_at,
            b.source_ref, b.source_hash, b.snapshot_hash AS baseline_snapshot_hash, b.imported_at,
            r.snapshot_hash, r.reason, r.created_at
       FROM lab_workspace_control c
       JOIN lab_workspace_baselines b ON b.baseline_id = c.active_baseline_id
       JOIN lab_workspace_revisions r ON r.workspace_id = c.workspace_id AND r.revision = c.active_revision
      WHERE c.workspace_id = ?1`
  ).bind(WORKSPACE_ID).first();

  if (!control) return jsonLab({ error: 'lab_workspace_empty' }, 404);
  const base = {
    status: 'ok',
    workspace_id: control.workspace_id,
    revision: Number(control.active_revision),
    baseline_id: control.active_baseline_id,
    source_ref: control.source_ref,
    source_hash: control.source_hash,
    snapshot_hash: control.snapshot_hash,
    reason: control.reason,
    imported_at: control.imported_at,
    updated_at: control.updated_at,
    revision_created_at: control.created_at
  };
  if (statusOnly) return jsonLab(base);

  const row = await db.prepare(
    'SELECT snapshot_json FROM lab_workspace_revisions WHERE workspace_id = ?1 AND revision = ?2'
  ).bind(WORKSPACE_ID, control.active_revision).first();
  if (!row?.snapshot_json) return jsonLab({ error: 'lab_workspace_corrupt' }, 500);
  let snapshot;
  try { snapshot = JSON.parse(row.snapshot_json); }
  catch { return jsonLab({ error: 'lab_workspace_corrupt' }, 500); }
  return jsonLab({ ...base, snapshot });
}

async function saveWorkspace(db, body, deviceId, jsonLab) {
  if (!Number.isSafeInteger(body?.expected_revision) || body.expected_revision < 1) {
    return jsonLab({ error: 'expected_revision_required' }, 400);
  }
  if (typeof body?.operation_id !== 'string' || !body.operation_id || body.operation_id.length > 160) {
    return jsonLab({ error: 'operation_id_required' }, 400);
  }

  let snapshot;
  try { snapshot = sanitizeSnapshotForLab(body.snapshot, false); }
  catch (error) { return jsonLab({ error: 'invalid_snapshot', detail: error.message }, 400); }

  const current = await db.prepare(
    'SELECT active_revision, active_baseline_id FROM lab_workspace_control WHERE workspace_id = ?1'
  ).bind(WORKSPACE_ID).first();
  if (!current) return jsonLab({ error: 'lab_workspace_empty' }, 409);

  const existing = await db.prepare(
    'SELECT revision, snapshot_hash FROM lab_workspace_revisions WHERE workspace_id = ?1 AND operation_id = ?2'
  ).bind(WORKSPACE_ID, body.operation_id).first();
  const snapshotJson = JSON.stringify(snapshot);
  const snapshotHash = await sha256Text(snapshotJson);
  if (existing) {
    if (existing.snapshot_hash !== snapshotHash) return jsonLab({ error: 'operation_id_conflict' }, 409);
    return jsonLab({ status: 'already_saved', revision: Number(existing.revision), snapshot_hash: snapshotHash });
  }

  if (Number(current.active_revision) !== body.expected_revision) {
    return jsonLab({ error: 'revision_conflict', current_revision: Number(current.active_revision) }, 409);
  }

  const revision = Number(current.active_revision) + 1;
  await db.batch([
    db.prepare(
      `INSERT INTO lab_workspace_revisions
       (workspace_id, revision, operation_id, baseline_id, snapshot_hash, snapshot_json, reason, device_id)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'LAB_SAVE', ?7)`
    ).bind(WORKSPACE_ID, revision, body.operation_id, current.active_baseline_id, snapshotHash, snapshotJson, deviceId),
    db.prepare(
      `UPDATE lab_workspace_control
          SET active_revision = ?2, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE workspace_id = ?1 AND active_revision = ?3`
    ).bind(WORKSPACE_ID, revision, body.expected_revision)
  ]);
  return jsonLab({ status: 'saved', revision, snapshot_hash: snapshotHash });
}

async function resetWorkspace(db, body, deviceId, jsonLab) {
  const current = await db.prepare(
    'SELECT active_revision, active_baseline_id FROM lab_workspace_control WHERE workspace_id = ?1'
  ).bind(WORKSPACE_ID).first();
  if (!current) return jsonLab({ error: 'lab_workspace_empty' }, 409);
  if (body?.expected_revision !== undefined && Number(body.expected_revision) !== Number(current.active_revision)) {
    return jsonLab({ error: 'revision_conflict', current_revision: Number(current.active_revision) }, 409);
  }
  const baseline = await db.prepare(
    'SELECT snapshot_json, snapshot_hash FROM lab_workspace_baselines WHERE baseline_id = ?1'
  ).bind(current.active_baseline_id).first();
  if (!baseline) return jsonLab({ error: 'baseline_missing' }, 500);

  const revision = Number(current.active_revision) + 1;
  const operationId = `reset:${current.active_baseline_id}:${revision}`;
  await db.batch([
    db.prepare(
      `INSERT INTO lab_workspace_revisions
       (workspace_id, revision, operation_id, baseline_id, snapshot_hash, snapshot_json, reason, device_id)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'RESET_TO_BASELINE', ?7)`
    ).bind(WORKSPACE_ID, revision, operationId, current.active_baseline_id, baseline.snapshot_hash, baseline.snapshot_json, deviceId),
    db.prepare(
      `UPDATE lab_workspace_control
          SET active_revision = ?2, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE workspace_id = ?1`
    ).bind(WORKSPACE_ID, revision)
  ]);
  return jsonLab({ status: 'reset', revision, baseline_id: current.active_baseline_id });
}

async function importBaseline(db, env, request, body, jsonLab) {
  const token = String(env.R2_CANON_READ_TOKEN || '').trim();
  if (!token) return jsonLab({ error: 'canon_r2_read_not_configured' }, 503);
  if (!body || typeof body !== 'object') return jsonLab({ error: 'invalid_import_body' }, 400);
  const sourceRef = String(body.source_ref || '');
  const sourceHash = String(body.source_hash || '');
  if (!sourceRef.startsWith('r2://nuevo-amanecer-prod-v2-backups/')) return jsonLab({ error: 'invalid_source_ref' }, 400);
  if (!SHA256_HEX.test(sourceHash)) return jsonLab({ error: 'invalid_source_hash' }, 400);

  let snapshot;
  try { snapshot = sanitizeSnapshotForLab(body.snapshot, true); }
  catch (error) { return jsonLab({ error: 'invalid_snapshot', detail: error.message }, 400); }

  const snapshotJson = JSON.stringify(snapshot);
  const snapshotHash = await sha256Text(snapshotJson);
  const signature = String(request.headers.get('x-lab-import-signature') || '').toLowerCase();
  const signed = [sourceRef, sourceHash, snapshotHash].join('\n');
  if (!await verifyHmacHex(token, signed, signature)) return jsonLab({ error: 'invalid_import_signature' }, 401);

  const current = await db.prepare(
    `SELECT c.active_revision, c.active_baseline_id, b.source_hash
       FROM lab_workspace_control c
       JOIN lab_workspace_baselines b ON b.baseline_id = c.active_baseline_id
      WHERE c.workspace_id = ?1`
  ).bind(WORKSPACE_ID).first();

  if (current?.source_hash === sourceHash) {
    return jsonLab({
      status: 'no_change',
      revision: Number(current.active_revision),
      baseline_id: current.active_baseline_id,
      source_ref: sourceRef,
      source_hash: sourceHash
    });
  }

  const existing = await db.prepare(
    'SELECT baseline_id, snapshot_hash FROM lab_workspace_baselines WHERE source_hash = ?1'
  ).bind(sourceHash).first();
  if (existing && existing.snapshot_hash !== snapshotHash) {
    return jsonLab({ error: 'baseline_hash_conflict' }, 409);
  }

  const baselineId = existing?.baseline_id || `canon-sql-${sourceHash.slice(0, 24)}`;
  const revision = current ? Number(current.active_revision) + 1 : 1;
  const operationId = `import-sql:${sourceHash}`;
  const actor = 'github-actions-r2';
  const statements = [];

  if (!existing) {
    statements.push(db.prepare(
      `INSERT INTO lab_workspace_baselines
       (baseline_id, source_ref, source_hash, snapshot_hash, snapshot_json, imported_by_device)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
    ).bind(baselineId, sourceRef, sourceHash, snapshotHash, snapshotJson, actor));
  }
  statements.push(db.prepare(
    `INSERT INTO lab_workspace_revisions
     (workspace_id, revision, operation_id, baseline_id, snapshot_hash, snapshot_json, reason, device_id)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'REFRESH_FROM_CANON', ?7)`
  ).bind(WORKSPACE_ID, revision, operationId, baselineId, snapshotHash, snapshotJson, actor));

  if (current) {
    statements.push(db.prepare(
      `UPDATE lab_workspace_control
          SET active_revision = ?2, active_baseline_id = ?3,
              updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE workspace_id = ?1`
    ).bind(WORKSPACE_ID, revision, baselineId));
  } else {
    statements.push(db.prepare(
      `INSERT INTO lab_workspace_control (workspace_id, active_revision, active_baseline_id)
       VALUES (?1, ?2, ?3)`
    ).bind(WORKSPACE_ID, revision, baselineId));
  }
  await db.batch(statements);
  return jsonLab({
    status: 'refreshed',
    revision,
    baseline_id: baselineId,
    source_ref: sourceRef,
    source_hash: sourceHash,
    snapshot_hash: snapshotHash,
    manifest_ref: body.manifest_ref || null,
    manifest_hash: body.manifest_hash || null,
    counts: snapshotCounts(snapshot)
  });
}

async function verifyHmacHex(secret, message, signature) {
  if (!/^[0-9a-f]{64}$/.test(signature)) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );
  const bytes = Uint8Array.from(signature.match(/../g).map(hex => parseInt(hex, 16)));
  return crypto.subtle.verify('HMAC', key, bytes, new TextEncoder().encode(message));
}

async function refreshFromCanon(db, env, deviceId, jsonLab) {
  const config = readR2Config(env);
  if (config.error) return jsonLab({ error: config.error }, 503);

  let latest;
  try { latest = await fetchLatestCanonBackup(config); }
  catch (error) { return jsonLab({ error: 'canon_backup_fetch_failed', detail: error.message }, 502); }

  let document;
  try { document = JSON.parse(latest.text); }
  catch { return jsonLab({ error: 'canon_backup_invalid_json', source_ref: latest.sourceRef }, 502); }

  let sourceSnapshot;
  try { sourceSnapshot = await resolveBackupDocument(document); }
  catch (error) { return jsonLab({ error: 'canon_backup_invalid', detail: error.message, source_ref: latest.sourceRef }, 502); }

  let snapshot;
  try { snapshot = sanitizeSnapshotForLab(sourceSnapshot, true); }
  catch (error) { return jsonLab({ error: 'canon_snapshot_invalid', detail: error.message, source_ref: latest.sourceRef }, 502); }

  const sourceHash = await sha256Bytes(new TextEncoder().encode(latest.text));
  const snapshotJson = JSON.stringify(snapshot);
  const snapshotHash = await sha256Text(snapshotJson);
  const baselineId = `canon-r2-${sourceHash.slice(0, 24)}`;

  const current = await db.prepare(
    `SELECT c.active_revision, c.active_baseline_id, b.source_hash
       FROM lab_workspace_control c
       JOIN lab_workspace_baselines b ON b.baseline_id = c.active_baseline_id
      WHERE c.workspace_id = ?1`
  ).bind(WORKSPACE_ID).first();

  if (current?.source_hash === sourceHash) {
    return jsonLab({
      status: 'no_change',
      revision: Number(current.active_revision),
      baseline_id: current.active_baseline_id,
      source_ref: latest.sourceRef,
      source_hash: sourceHash
    });
  }

  const existingBaseline = await db.prepare(
    'SELECT baseline_id, snapshot_hash FROM lab_workspace_baselines WHERE source_hash = ?1'
  ).bind(sourceHash).first();

  if (existingBaseline && existingBaseline.snapshot_hash !== snapshotHash) {
    return jsonLab({ error: 'baseline_hash_conflict' }, 409);
  }

  const revision = current ? Number(current.active_revision) + 1 : 1;
  const operationId = `refresh:${sourceHash}`;
  const statements = [];
  if (!existingBaseline) {
    statements.push(db.prepare(
      `INSERT INTO lab_workspace_baselines
       (baseline_id, source_ref, source_hash, snapshot_hash, snapshot_json, imported_by_device)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
    ).bind(baselineId, latest.sourceRef, sourceHash, snapshotHash, snapshotJson, deviceId));
  }
  const effectiveBaselineId = existingBaseline?.baseline_id || baselineId;
  statements.push(db.prepare(
    `INSERT INTO lab_workspace_revisions
     (workspace_id, revision, operation_id, baseline_id, snapshot_hash, snapshot_json, reason, device_id)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'REFRESH_FROM_CANON', ?7)`
  ).bind(WORKSPACE_ID, revision, operationId, effectiveBaselineId, snapshotHash, snapshotJson, deviceId));

  if (current) {
    statements.push(db.prepare(
      `UPDATE lab_workspace_control
          SET active_revision = ?2, active_baseline_id = ?3,
              updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE workspace_id = ?1`
    ).bind(WORKSPACE_ID, revision, effectiveBaselineId));
  } else {
    statements.push(db.prepare(
      `INSERT INTO lab_workspace_control (workspace_id, active_revision, active_baseline_id)
       VALUES (?1, ?2, ?3)`
    ).bind(WORKSPACE_ID, revision, effectiveBaselineId));
  }

  await db.batch(statements);
  return jsonLab({
    status: 'refreshed',
    revision,
    baseline_id: effectiveBaselineId,
    source_ref: latest.sourceRef,
    source_hash: sourceHash,
    snapshot_hash: snapshotHash,
    counts: snapshotCounts(snapshot)
  });
}

export function readR2Config(env) {
  const accountId = String(env.R2_CANON_ACCOUNT_ID || '').trim();
  const token = String(env.R2_CANON_READ_TOKEN || '').trim();
  const bucket = String(env.R2_CANON_BUCKET || 'nuevo-amanecer-prod-v2-backups').trim();
  const prefix = String(env.R2_CANON_PREFIX || 'nuevo-amanecer-prod-v2/').trim();
  if (!accountId || !token) return { error: 'canon_r2_read_not_configured' };
  return { accountId, token, bucket, prefix };
}

export async function fetchLatestCanonBackup(config, fetchImpl = fetch) {
  const base = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(config.accountId)}/r2/buckets/${encodeURIComponent(config.bucket)}/objects`;
  const listUrl = new URL(base);
  listUrl.searchParams.set('prefix', config.prefix);
  listUrl.searchParams.set('per_page', '1000');
  const listed = await fetchImpl(listUrl, { headers: { authorization: `Bearer ${config.token}` } });
  if (!listed.ok) throw new Error(`R2 list failed: ${listed.status}`);
  const payload = await listed.json();
  if (!payload?.success || !Array.isArray(payload.result)) throw new Error('R2 list response invalid');
  const latest = selectLatestR2Object(payload.result);
  if (!latest) throw new Error('No JSON backups found under configured prefix');

  const encodedKey = String(latest.key).split('/').map(encodeURIComponent).join('/');
  const response = await fetchImpl(`${base}/${encodedKey}`, { headers: { authorization: `Bearer ${config.token}` } });
  if (!response.ok) throw new Error(`R2 get failed: ${response.status}`);
  const text = await response.text();
  if (!text || new TextEncoder().encode(text).length > MAX_SNAPSHOT_BYTES) throw new Error('Backup empty or over 10 MB');
  return { key: latest.key, text, sourceRef: `r2://${config.bucket}/${latest.key}` };
}

export function selectLatestR2Object(objects) {
  const candidates = (Array.isArray(objects) ? objects : [])
    .filter(item => item && typeof item.key === 'string' && /\.json$/i.test(item.key));
  candidates.sort((a, b) => {
    const ta = Date.parse(a.uploaded || a.last_modified || a.lastModified || '') || 0;
    const tb = Date.parse(b.uploaded || b.last_modified || b.lastModified || '') || 0;
    if (ta !== tb) return tb - ta;
    return String(b.key).localeCompare(String(a.key));
  });
  return candidates[0] || null;
}

export async function resolveBackupDocument(document) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) throw new Error('backup must be an object');
  if (!Object.prototype.hasOwnProperty.call(document, 'format')) return document;
  if (document.format !== BACKUP_FORMAT || Number(document.version) !== 1) throw new Error('unsupported backup wrapper');
  if (!document.payload || typeof document.payload !== 'object' || Array.isArray(document.payload)) throw new Error('backup payload missing');
  if (document.integrity != null) {
    const integrity = document.integrity;
    if (integrity.algorithm !== 'SHA-256' || integrity.scope !== 'payload-json' || !SHA256_HEX.test(String(integrity.value || ''))) {
      throw new Error('unsupported backup integrity');
    }
    const actual = await sha256Text(JSON.stringify(document.payload));
    if (actual !== integrity.value) throw new Error('backup integrity mismatch');
  }
  return document.payload;
}

export function sanitizeSnapshotForLab(source, fromCanon = false) {
  validateSnapshot(source);
  const snapshot = JSON.parse(JSON.stringify(source));
  delete snapshot.cloudSync;
  snapshot.version = Number(snapshot.version);
  snapshot.updatedAt = new Date().toISOString();

  if (fromCanon) {
    snapshot.cart = [];
    snapshot.draft = null;
    snapshot.ui = { ...(snapshot.ui || {}), currentPage: 'pageMenu' };
    snapshot.locks = { master: false, readOnly: false, modules: {} };
    delete snapshot.security;
  }
  return snapshot;
}

export function validateSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw new Error('snapshot must be an object');
  if (![8, 9].includes(Number(snapshot.version))) throw new Error('snapshot version must be 8 or 9');
  if (!snapshot.data || typeof snapshot.data !== 'object' || Array.isArray(snapshot.data)) throw new Error('snapshot.data required');
  for (const key of ['productos', 'ventas', 'clientes', 'creditos', 'gastos', 'cajMovs']) {
    if (!Array.isArray(snapshot.data[key])) throw new Error(`data.${key} must be an array`);
  }
  if (snapshot.data.cashClosures !== undefined && !Array.isArray(snapshot.data.cashClosures)) throw new Error('data.cashClosures must be an array');
  if (snapshot.data.inventoryMovements !== undefined && !Array.isArray(snapshot.data.inventoryMovements)) throw new Error('data.inventoryMovements must be an array');
  const bytes = new TextEncoder().encode(JSON.stringify(snapshot)).length;
  if (bytes > MAX_SNAPSHOT_BYTES) throw new Error('snapshot exceeds 10 MB');
}

export function snapshotCounts(snapshot) {
  const d = snapshot.data || {};
  return {
    productos: d.productos?.length || 0,
    ventas: d.ventas?.length || 0,
    clientes: d.clientes?.length || 0,
    creditos: d.creditos?.length || 0,
    pagos: (d.creditos || []).reduce((sum, credit) => sum + (Array.isArray(credit?.pagos) ? credit.pagos.length : 0), 0),
    gastos: d.gastos?.length || 0,
    cajMovs: d.cajMovs?.length || 0
  };
}

async function sha256Text(text) {
  return sha256Bytes(new TextEncoder().encode(text));
}

async function sha256Bytes(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

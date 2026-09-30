import { createTursoD1Adapter } from '../cloudflare-lab/src/turso-d1-adapter.js';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/probe') return json({ error: 'not_found' }, 404);

    const db = createTursoD1Adapter(env);
    const sessionId = crypto.randomUUID();
    const principalId = 'session:' + sessionId;
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const token = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
    const tokenHash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');

    let inserted = false;
    try {
      await db.batch([
        db.prepare(
          "INSERT INTO devices (device_id, role, status, credential_hash, last_seen_at) VALUES (?1, 'writer', 'active', ?2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) ON CONFLICT(device_id) DO UPDATE SET role='writer', status='active', credential_hash=excluded.credential_hash, last_seen_at=excluded.last_seen_at"
        ).bind(principalId, tokenHash),
        db.prepare(
          "INSERT INTO auth_sessions (session_id, token_hash, status, last_seen_at) VALUES (?1, ?2, 'active', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))"
        ).bind(sessionId, tokenHash)
      ]);
      inserted = true;
      return json({ status: 'pass', batch: 'activation-equivalent' });
    } catch (error) {
      return json({
        status: 'fail',
        name: String(error?.name || 'Error').slice(0, 80),
        code: String(error?.code || '').slice(0, 120),
        message: String(error?.message || error || 'unknown').slice(0, 700)
      }, 500);
    } finally {
      if (inserted) {
        try {
          await db.batch([
            db.prepare('DELETE FROM auth_sessions WHERE session_id=?1').bind(sessionId),
            db.prepare('DELETE FROM devices WHERE device_id=?1').bind(principalId)
          ]);
        } catch {}
      }
    }
  }
};

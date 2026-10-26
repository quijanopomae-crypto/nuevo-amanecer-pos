-- BORRADOR 0038 pos_assistant_memory. Numero 0038 confirmado por A3, pero el archivo sigue en borradores/ hasta numerarlo en su PR.
-- Solo aditiva: CREATE TABLE y CREATE INDEX con IF NOT EXISTS. No toca datos existentes.
-- Memoria permanente de negocio del asistente. Se usa solo con el interruptor ASSISTANT_MEMORY_V=1 (apagado por defecto).
-- presentacion = codigo de producto + presentacion + unidades (rol_min empleado).
-- preferencia = plantilla cerrada con valor de lista o numero (rol_min owner). Nunca texto libre.
-- No guarda proveedor, costos, clientes, existencias, instrucciones ni conversaciones.
-- Un negocio por base: no lleva business_id (ninguna migracion del repo lo usa).
CREATE TABLE IF NOT EXISTS pos_assistant_memory (
  memory_id TEXT PRIMARY KEY NOT NULL CHECK (length(memory_id) BETWEEN 1 AND 64),
  scope TEXT NOT NULL CHECK (scope IN ('negocio', 'dispositivo')),
  kind TEXT NOT NULL CHECK (kind IN ('presentacion', 'preferencia')),
  subject_ref TEXT NOT NULL DEFAULT '' CHECK (length(subject_ref) <= 60),
  value_json TEXT NOT NULL CHECK (json_valid(value_json) AND length(value_json) <= 1000),
  rol_min TEXT NOT NULL DEFAULT 'owner' CHECK (rol_min IN ('owner', 'empleado')),
  source TEXT NOT NULL CHECK (source IN ('ensenado')),
  state TEXT NOT NULL DEFAULT 'activa' CHECK (state IN ('activa', 'reemplazada', 'olvidada')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  supersedes TEXT,
  device_id TEXT NOT NULL CHECK (length(device_id) BETWEEN 1 AND 64),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT,
  forgotten_by TEXT CHECK (forgotten_by IS NULL OR length(forgotten_by) BETWEEN 1 AND 64),
  forgotten_at TEXT,
  CHECK ((kind = 'preferencia' AND rol_min = 'owner') OR kind = 'presentacion')
);
CREATE UNIQUE INDEX IF NOT EXISTS pos_assistant_memory_active ON pos_assistant_memory(scope, kind, subject_ref) WHERE state = 'activa';
CREATE INDEX IF NOT EXISTS pos_assistant_memory_lookup ON pos_assistant_memory(state, scope, kind, updated_at);

# Production hardening — Fase 3: binding D1 neutral

## Resultado
El runtime usa `getDatabase(env)` y las configuraciones activas LAB, STAGING y PROD declaran `binding = "DB"`.

## Compatibilidad
`database-binding.js` conserva temporalmente `env.nuevo_amanecer_lab` como fallback para fixtures, sesiones antiguas de desarrollo y rollback de código. Ningún módulo de negocio lo lee directamente.

## Invariantes
- No cambian `database_name` ni `database_id` de LAB o PROD.
- No se despliega Worker en esta fase.
- PROD sigue prohibiendo el database_id de LAB.
- Worker, commerce, financial, expenses y LAB workspace consumen el mismo accessor neutral.

## Rollback
Revertir el PR restaura el nombre de binding en repositorio; no existe estado remoto que revertir porque esta fase no despliega.


## Corrección posterior detectada por STAGING

El primer smoke remoto de STAGING detectó que `a6-canonical.js` conservaba cinco accesos
directos a `env.nuevo_amanecer_lab`. La autenticación usaba `DB`, pero las lecturas CANON
pasaban un binding inexistente y devolvían 500.

La regresión ahora escanea todos los archivos JavaScript de `tools/cloudflare-lab/src/`.
Solo `database-binding.js` puede conocer el nombre legacy. Además existe una prueba
`ACTIVE` con un entorno que contiene `DB` y no contiene el binding legacy.

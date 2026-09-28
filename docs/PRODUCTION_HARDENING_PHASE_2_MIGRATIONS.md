# Production hardening — Fase 2: migraciones neutrales

## Objetivo
Separar la propiedad del historial D1 del directorio LAB sin convertir el movimiento en migraciones nuevas.

## Fuente canónica
`infra/database/migrations/` contiene exactamente los mismos 13 blobs que antes residían en `tools/cloudflare-lab/migrations/`.

## Invariantes
- No cambia un byte de SQL.
- No se ejecuta SQL remoto en esta fase.
- LAB, STAGING y PROD consumen la misma ruta neutral.
- `neutral-migrations-contract.test.mjs` compara cada archivo con su Git blob SHA anterior al movimiento.
- PROD conserva su database_id productivo y el guard que prohíbe el ID D1 de LAB.

## Rollback
Revertir el PR restaura las rutas del repositorio. Como esta fase no ejecuta migraciones remotas, no requiere rollback de D1.

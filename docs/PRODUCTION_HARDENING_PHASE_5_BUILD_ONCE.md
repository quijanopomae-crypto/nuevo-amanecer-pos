# Production hardening — Fase 5: build once / promote same artifact

## Objetivo

Eliminar la diferencia entre “lo probado en STAGING” y “lo publicado en producción”
para los archivos estáticos del POS.

La regla es:

```
target_head exacto
→ ensamblar una vez
→ sellar manifiesto por archivo
→ desplegar esos bytes en STAGING
→ smoke PASS
→ publicar candidato inmutable en R2 STAGING
→ descargar ese candidato
→ verificar SHA + manifiesto
→ desplegar exactamente esos bytes en PROD
```

## Candidato STAGING

El workflow STAGING crea un manifiesto determinístico para `_site` con:

- ruta relativa;
- tamaño en bytes;
- SHA-256 por archivo;
- `target_head` exacto;
- conteo total y bytes totales.

Luego genera un `tar.gz` normalizado con orden estable, mtime fijo, uid/gid neutros y
`gzip -n`. El artefacto queda identificado por su SHA-256.

El archivo se construye antes del deploy STAGING, pero **no se publica como candidato**
hasta que el smoke remoto STAGING haya pasado.

El descriptor promovible tiene estado obligatorio `STAGING_SMOKE_PASS`.

## Producción

`.github/workflows/production-release.yml` no reconstruye el POS.

Está prohibido dentro de ese workflow:

- copiar `POS/` para reconstruir `_site`;
- sustituir `__BUILD_HASH__` mediante `sed`;
- crear un segundo bundle estático;
- escribir D1.

El workflow:

1. exige trigger del owner y `target_head` exacto;
2. descarga `candidate.json` desde R2 STAGING;
3. comprueba que pertenece al mismo target y tiene smoke PASS;
4. descarga el artefacto content-addressed;
5. valida el SHA-256 del archivo comprimido;
6. inspecciona el namespace del tar antes de extraerlo;
7. valida SHA-256 del manifiesto;
8. verifica todos los archivos con `site-artifact.mjs`;
9. instala el directorio verificado sin reconstruirlo;
10. hace dry-run, deploy y smoke público PROD.

## Frontera exacta de la garantía

La garantía “same artifact” cubre los **bytes estáticos servidos como sitio POS**.

El Worker web de Cloudflare se compila desde el mismo `target_head` exacto que produjo el
candidato. No se afirma todavía que el bundle compilado del Worker sea el mismo binario
entre STAGING y PROD; ese endurecimiento puede incorporarse posteriormente si se decide
empaquetar también el Worker compilado.

La configuración pública de entorno permanece fuera del artefacto estático mediante
`/runtime-config.js`, por diseño. Así STAGING y PROD pueden usar exactamente el mismo
sitio mientras apuntan a backends diferentes.

## Seguridad y rollback

Este cambio no crea por sí solo un release productivo. El workflow PROD solo corre cuando
exista un futuro `ops/production-release-trigger.json` autorizado por el owner.

El artifact bucket de origen es `nuevo-amanecer-staging-artifacts`. Producción no necesita
leer ni escribir D1 para promover el sitio.

El SHA del artefacto y el SHA del manifiesto quedan disponibles para la Fase 8 de rollback.

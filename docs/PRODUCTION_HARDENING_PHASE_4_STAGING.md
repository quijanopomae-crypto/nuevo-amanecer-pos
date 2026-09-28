# Production hardening — Fase 4B: STAGING CANON real

## Arquitectura

STAGING usa recursos exclusivos de Cloudflare: Worker web, Worker backend, D1 y R2.
Comparte código y migraciones con CANON, pero no comparte datos, IDs, buckets ni secreto
de activación.

## Dataset

El baseline contiene únicamente un producto y un cliente explícitamente sintéticos.
El esquema CANON impide pasar directamente a ACTIVE. El workflow hace la transición
solo en D1 STAGING y coloca un `trap` antes de retirar temporalmente el trigger
`canonical_control_no_legacy`. El trigger se restaura ejecutando la migración 0013
incluso si el paso falla.

## Identidad de runtime

- LAB: `RUNTIME_ENVIRONMENT=lab`
- STAGING: `RUNTIME_ENVIRONMENT=staging`
- PROD: `RUNTIME_ENVIRONMENT=production`

`/lab/workspace` responde 404 fuera de LAB. `/health` expone una identidad distinta
por entorno.

## Autorización

El workflow no se ejecuta al fusionar código. Solo un commit del owner sobre
`ops/staging-deploy-trigger.json` puede activarlo y debe declarar un `target_head`
exacto. El artefacto desplegado se construye desde ese target, no desde cambios
posteriores.

## Rollback

STAGING puede eliminarse y recrearse sin afectar producción. Ningún paso de esta fase
escribe D1/R2 productivos ni usa datos comerciales.


## Compatibilidad de import D1

El seed sintético se ejecuta mediante `wrangler d1 execute --file` sobre D1 remota. El
archivo no contiene `BEGIN` ni `COMMIT` explícitos; D1 administra la transacción del
import internamente. El orden de las sentencias sintéticas permanece intacto.

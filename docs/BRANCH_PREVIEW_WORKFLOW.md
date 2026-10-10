# Branch Preview Workflow — Nuevo Amanecer POS

## Objetivo

Eliminar la segunda copia funcional permanente del producto y trabajar con una sola fuente de verdad: `POS/**` en CANON.

Cada cambio se desarrolla en una rama aislada y se valida sobre el mismo SHA que luego se propone para merge.

## Flujo obligatorio

```text
CANON HEAD
  -> rama aislada
  -> implementación mínima
  -> pruebas focalizadas
  -> regresiones
  -> Draft PR
  -> CANON Critical CI / E2E Smoke CI
  -> Reviewer + Forensic
  -> preview temporal del mismo SHA, cuando aplique
  -> veredicto READY FOR MERGE
  -> comprobar autorización vigente del owner
  -> merge
  -> deploy incluido en el alcance autorizado si corresponde
  -> borrar rama
```

## Nombres de rama

- `feature/<tema>`
- `fix/<tema>`
- `perf/<tema>`
- `arch/<tema>`

No crear nuevas ramas `lab/*`.

## Reglas del preview

El preview:

- no es un fork permanente del producto;
- no contiene cambios adicionales;
- debe identificar el SHA servido;
- usa datos sintéticos/aislados o backend autorizado;
- nunca convierte un estado provisional en definitivo;
- no autoriza producción.

Si el SHA cambia, la validación del preview debe repetirse.

## Gates

Un PR no puede solicitar merge con:

- CANON Critical CI rojo;
- E2E requerido rojo;
- P0/P1 abierto;
- divergencia entre SHA revisado y SHA servido;
- diff fuera de alcance;
- migración o cambio de secrets no autorizado.

Los tests se actualizan solo cuando una arquitectura aprobada invalida una expectativa estructural. La nueva prueba debe conservar o reforzar el invariante.

## Separación de acciones

Crear rama, commit y Draft PR no equivale a:

- merge;
- deploy;
- migración;
- escritura de producción;
- cambio de secrets.

La autorización vigente se interpreta según `AGENTS.md`: «impleméntalo» o «aplícalo a CANON» cubre la publicación, integración, despliegue y migraciones aditivas necesarias del cambio solicitado. No se repite la consulta dentro del alcance aprobado. Borrados, migraciones destructivas, force-push, cambios de secrets y ampliaciones requieren autorización explícita específica. Se conservan respaldo, pruebas, revisión independiente y verificación posterior.

## Fuente de verdad

- Producto: `POS/**`.
- Backend/runtime CANON: código versionado que use producción, aunque algunos paths históricos todavía contengan el nombre `cloudflare-lab`.
- Migraciones: `infra/database/migrations/**`.
- Tests: `tests/**` y harnesses versionados.
- Historial/evidence: no define por sí solo el estado actual.

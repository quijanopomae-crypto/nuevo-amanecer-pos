# Branch Preview Workflow — Nuevo Amanecer POS

## Objetivo

Eliminar la segunda copia funcional permanente del producto y trabajar con una sola fuente de verdad: `POS/**` en CANON.

El flujo ordinario es **DIRECTO**: la misión autorizada se integra en CANON, AUTO-DEV CI prueba y publica automáticamente solo superficies web elegibles. Una rama temporal y un único PR de código son opcionales para riesgo alto o cuando GitHub lo exija. No existe segundo PR de publicación.

## Flujo de una misión

```text
Orden del propietario
 -> editar CANON (o una sola rama de integración si hace falta)
 -> AUTO-DEV CI: contratos + negocio + navegador
 -> gate exacto de alcance/riesgo y SHA servido
 -> deploy web elegible + comprobación + rollback al fallar
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

Un cambio no puede publicarse con:

- AUTO-DEV CI rojo;
- E2E crítico requerido rojo;
- P0/P1 abierto;
- falta de revisión técnica y evidencias exigidas por la categoría de riesgo; se admite revisión independiente automatizada real, sin dependencia de Reviewer/Forensic nominal;
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

La autorización vigente se interpreta según `AGENTS.md`: «impleméntalo» o «aplícalo a CANON» cubre la publicación, integración, despliegue y migraciones aditivas necesarias del cambio solicitado. No se repite la consulta dentro del alcance aprobado. El force-push está siempre prohibido. Borrados de datos de producción (solo si el dueño los pide expresamente y con respaldo previo), migraciones destructivas, cambios de secrets no incluidos en el pedido y ampliaciones de alcance requieren autorización explícita específica; un secreto que falta solo lo puede dar el dueño en su chat. Se conservan respaldo, pruebas, revisión proporcional según `docs/DEVELOPMENT_RISK_POLICY.md` y verificación posterior. Los cambios estrictamente visuales, sin exposición ni escritura de datos, pueden avanzar con aprobación de diseño del owner, pruebas y preview del mismo SHA; la clasificación y las evidencias se registran en el commit/recibo versionado cuando corresponda, sin PR adicional.

## Fuente de verdad

- Producto: `POS/**`.
- Backend/runtime CANON: código versionado que use producción, aunque algunos paths históricos todavía contengan el nombre `cloudflare-lab`.
- Migraciones: `infra/database/migrations/**`.
- Tests: `tests/**` y harnesses versionados.
- Historial/evidence: no define por sí solo el estado actual.

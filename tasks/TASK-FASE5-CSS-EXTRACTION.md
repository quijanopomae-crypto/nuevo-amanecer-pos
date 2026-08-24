# TASK — FASE 5: CSS STATIC EXTRACTION

## Objetivo

Extraer los 8 bloques `<style>` reales del producto canónico a archivos CSS
externos bajo `POS/css/`, generando `POS/index.html` que referencia esos
archivos, sin alterar ningún otro contenido (DOM, IDs, handlers, scripts,
comentarios HTML, orden).

## Base y blob

- Base commit: `d0125183918a2f6f710d4d234005c3ac8757c1a6`
- Producto canónico: `CVV2.4_backup_antes_demo-1.html` (blob git `2dec6363d8aeef52da64ba60ac8eac8eb14f75f7`, 7164 líneas, LF en blob / CRLF en disco).
- El producto canónico está PROHIBIDO de modificar (solo lectura). La fuente se
  extrae del blob vía `git show d012518:CVV2.4_backup_antes_demo-1.html`.

## Arquitectura

| Archivo | Contenido |
|---------|-----------|
| `POS/css/base.css`        | B1 (L10-1295) |
| `POS/css/layout.css`      | B2 (L1297-1446) |
| `POS/css/components.css`  | B3..B8 concatenados en orden documental (`\n` entre bloques) |
| `POS/css/responsive.css`  | VACÍO por diseño (solo comentario) |
| `POS/css/print.css`       | VACÍO por diseño (solo comentario) |

Bloques: B3 `id=na-phase5-sales-cashiers`, B4 `id=na-fase7-credit-css`,
B5 `id=na-fase8-reportes-css`, B6 `id=na-fase9-sugerencia-css`,
B7 `id=na-phase10-control-master`; B1, B2, B8 sin id. Ningún bloque tiene `media`.
Los falsos positivos de templates JS son excluidos por el parser. Aclaración de
coordenadas: L3000 y L3712 son líneas del CANÓNICO; en `POS/index.html` los
templates JS equivalentes están desplazados a L1545 y L2257 por la extracción de
CSS (la numeración canónica no aplica al derivado).

### Invariante de oro (byte-exacto, LF)

```
base + '\n' + layout + '\n' + components  ===  join(contenidos B1..B8, '\n')
```

## index.html

- Derivado del blob. Se eliminan las líneas de los 8 tags de bloque completos.
- En `<head>` (donde estaba B1, tras el `<script>` CDN de L9) se insertan los 5
  links en este orden: `css/base.css`, `css/layout.css`, `css/components.css`,
  `css/responsive.css`, `css/print.css` (rel=stylesheet, sin media, sin id).
- Política de colapso: B1 se reemplaza por los 5 links; cada bloque B2..B8 se
  reemplaza por una única línea vacía y se colapsa el span extendido
  (bloque + líneas en blanco adyacentes) a una sola línea vacía, sin entrar
  nunca en regiones `<script>`. No se toca nada más.

## Riesgo documentado (arquitecto, F1)

`responsive.css` y `print.css` quedan vacíos a propósito: el invariante
byte-exacto exige que la concatenación reconstruya exactamente los 8 bloques.
Añadir reglas/selectores rompería el invariante en esta fase. El trabajo de
media-queries responsive/print se abordará en una fase posterior que actualice
el invariante explícitamente.

## Comandos de re-ejecución

```powershell
node --check tests/equivalence/lib/css-extract.mjs
node --check tests/equivalence/css-static-extraction.test.mjs
node --test tests/equivalence/css-static-extraction.test.mjs
node --test tests/characterization/baseline-fixture.test.mjs
```

## Refuerzo de gate (respuesta a revisión N1/N2)

- **N1 — anclaje de blob**: T11 (`source blob anchor`) verifica que
  `buildPosCandidate().sourceBlob` (computado por `readSourceLf` vía
  `gitBlobSha1(buffer)`) coincide con el blob autorizado hardcodeado
  `2dec6363d8aeef52da64ba60ac8eac8eb14f75f7` y lo re-computa de forma
  independiente desde el buffer crudo de `git show`. No se usa la constante
  autoreferencial `SOURCE_BLOB` para la comparación.
- **N2 — markup blindado**: T12 (`full markup equivalence minus style spans vs
  minus links`) compara byte-exacto el canónico sin los 8 spans `<style>`
  (colapsados a una línea vacía con la misma política de blank-collapse del
  builder) contra `POS/index.html` sin las 5 líneas
  `<link rel="stylesheet" href="css/...">`. Cierra la brecha de markup estático
  (clases/texto/comentarios fuera de ids/handlers).
- **N5 — coordenadas**: L3000/L3712 son del CANÓNICO; en `POS/index.html` los
  templates equivalentes están en L1545/L2257 (aclarado arriba).

## Estado

IMPLEMENTATION_READY_FOR_TEST — ver `evidence/css-extraction/report.json`.

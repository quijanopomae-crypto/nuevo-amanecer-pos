# CANON LAB Root Promotion V1

## Objetivo

Cerrar la promoción incompleta LAB -> CANON sin copiar el directorio LAB completo ni debilitar la autoridad productiva.

## Decisión arquitectónica

- LAB y CANON comparten el núcleo heredado `POS/js/legacy-inline/*`.
- LAB agrega extensiones experimentales y un workspace aislado.
- CANON agrega autoridad productiva, sesión, sync, outbox y adaptadores.
- La corrección de raíz consiste en:
  1. un contrato único CANON -> UI;
  2. promover solo diferencias LAB aprobadas que no estén ya en CANON;
  3. mantener un único owner por renderer/lifecycle;
  4. probar paridad funcional/visual mediante allowlist explícita.

## Etapa 1 — Contrato único CANON -> UI

Crear `POS/js/adapters/canonical-ui-adapter.js` y delegar desde `canonical-client.js`.
El adapter debe exponer el contrato que realmente consume la UI heredada/productiva y preservar aliases de compatibilidad.

Producto mínimo completo:
- id / product_id
- name / nombre
- sku
- barcode / codigo
- codigosAlternativos
- cat / categoria
- marca
- descripcion
- icon / icono
- imagen
- unidad
- unidadCompra
- factorCompra
- costo
- precio
- precioCaja
- unidCaja
- stock
- stockRevision
- stockMin
- venc
- incluyeIGV
- tipoImpuesto
- impuestoComplementario
- controlInventario / controlaStock

Clientes, créditos y pagos también quedan centralizados en el mismo adapter.

## Etapa 2 — Promoción visual válida

Del PR #131 se conservan únicamente:
- Motion del badge de carrito conectado al evento real;
- Motion del toast conectado al evento real;
- CSS de notificaciones que no pisa el centrado.

No se incorpora `client-list-motion.js` porque el módulo productivo `client-credit-accounts-v2.js` ya contiene el lifecycle aprobado de entrada/salida de la lista.

## Etapa 3 — Ownership de renderers

Motion y vistas derivadas no pueden reemplazar `cliRender`, `posRender` ni otros renderers autoritativos después de sus gates.
La proyección CANON debe componerse mediante puntos de integración probados, no ownership visual tardío.

## Etapa 4 — Gate de paridad

Añadir pruebas que:
- comparen el contrato UI contra registros CANON sintéticos completos;
- verifiquen que no existe una segunda animación de Clientes;
- mantengan `client-renderer-collision.test.mjs` intacto;
- comprueben que los assets nuevos están en el shell/PWA;
- documenten las diferencias LAB-only permitidas.

## Invariantes

- No tocar D1, R2 ni datos reales.
- No ejecutar ventas reales.
- No cambiar reglas de comercio, FIFO, caja ni crédito.
- No debilitar fail-closed, idempotencia, autoridad o sesión.
- No copiar `laboratorio/pos-lab/index.html` sobre `POS/index.html`.
- No introducir dependencia runtime desde `POS/**` hacia `laboratorio/**`.
- Rollback por revert del PR.

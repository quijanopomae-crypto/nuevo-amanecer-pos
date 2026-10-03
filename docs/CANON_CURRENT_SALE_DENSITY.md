# Venta actual — densidad final

Owner 2026-10-02: imagen 1 actual; imagen 2 objetivo exclusivo del panel. Base CANON `9278e2ce95df9ce01deec220a16e858551ad4e33`. Sin merge/deploy.

Antes de editar: filas min 72/74px, padding 9px vertical, miniaturas 48/50px, botones 29px; nombres sin clamp, encabezado 72/76px y CTAs 78px. Las reglas >=1280 repiten y agrandan las mismas medidas. DOM: no requiere cambios; nombre/unidades y handlers ya existen. Congelados logo/cabecera/cliente superior/categorías/catálogo/navegación y todo estado comercial.

READS CSS del carrito y DOM renderizado; WRITES exclusivamente reglas CSS de Venta actual y pruebas de esta interfaz. DOM_AFFECTED ninguno estructural; STATE_AFFECTED ninguno; STORAGE_AFFECTED ninguno; DOMAIN_INVARIANTS handlers/cálculos/stock/margen/cliente intactos. CROSS_MODULE_IMPACT presentación del carrito, sin cambios a productores/consumidores de negocio. CSS fuera del panel debe conservarse byte por byte en cada regla.

Medidas: filas min 62px, padding 6px, miniatura 40px, cantidad 26px (32px en pointer coarse), nombre hasta dos líneas, precio 15px; encabezado 60px; Total 50px, acciones 38px y cobro 64px. Eliminar redundancias desktop del panel y conservar drawer Android escritorio.

Nota intencionalmente fuera: contrato de venta actual no admite una nota persistente. No input decorativo. Fotografías del catálogo/productos no se modifican; fixtures de screenshots son sintéticos.

Validación: escenarios vacío/1/2/6/nombre largo/VARIOS/cliente, controles existentes, responsive, screenshots 1/2/6; focal POS, CANON Critical y E2E Smoke. Rollback: revertir el commit.

Resultado local: 735 regresiones Node PASS, 22 E2E Chrome PASS y 31 gates de paridad/interface PASS. Focal POS incluye checksum de todas las reglas fuera de Venta actual (incluido carrito superior) y del decorator JavaScript respecto al HEAD inicial. No se cambia JavaScript ni DOM. Dieciocho reglas desktop redundantes del panel se eliminaron; desktop y móvil comparten las medidas, con excepción explícita para targets de toque. Android sitio de escritorio se prueba por emulación, no equipo físico.

Capturas finales sintéticas, panel recortado a 440px, viewport 1536x1024: `../current-sale-screenshots/1-productos.png`, `2-productos.png`, `6-productos.png`. Filas cortas medidas 62px; nombre largo hasta 74.5px; Total 50px y CTAs 64px. Espacio restante queda en la lista independiente y no estira filas para rellenar el panel.

Archivos de producto: solo `POS/css/canon-pos-reference-ui.css`. Pruebas: `tests/product-fixes/fix-pos-reference-ui/canon-pos-reference-ui.test.mjs`, `current-sale-scope-freeze.test.mjs`, `tests/e2e/current-sale-density.spec.ts`. Documento: este archivo. No hay nuevas reglas visuales fuera del panel ni cambios a los handlers de cantidad, stock, descuento, margen, cliente, VARIOS o cobro.

## Ajuste exclusivo del footer — mismo PR #410

Parte superior aprobada congelada respecto a dbfaa90: filas, miniaturas, nombres, cantidad, precios, eliminar y encabezado. Solo se editan seis reglas existentes del footer, sin nuevos overrides ni JavaScript/DOM. Total 44px y texto 26px; acciones secundarias 36px; cobro 52px; separación entre los tres bloques 5px. Padding exterior reducido. Regresión adicional verifica checksum de todo el CSS salvo esas seis reglas. Captura nueva: `../current-sale-screenshots/6-productos-footer-final.png`.

Validación del ajuste: 16 pruebas focales Node PASS; 22 E2E Chrome PASS; `git diff --check` PASS. Footer desktop con seis productos: 176.19px (antes 221.19px), reducción 20.3%; Total 44px, acciones 36px, cobro 52px. Captura espera la inicialización del decorator antes de tomarse.

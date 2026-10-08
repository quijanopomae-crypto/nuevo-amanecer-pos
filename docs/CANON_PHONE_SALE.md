# Venta CANON para teléfono

Base: `d886bb542daa01c8e86108971eb220b7d5a610e5` en `feature/v1.3-mobile-cloud`.

Alcance autorizado: la pantalla de venta en teléfonos. Se usa el clasificador existente `na-pos-phone-device` (pantalla corta <=600 px y puntero táctil); PC y tablet conservan catálogo y panel/drawer anteriores. El cambio no altera backend, reglas de pago, stock ni persistencia.

La fila superior contiene un único cliente, Agregar y cámara. El catálogo se abre en un diálogo con los mismos nodos, búsqueda, categorías, VARIOS y mayorista existentes. El carrito permanece visible y el cobro usa `abrirCobro('normal')`. La cuenta del cliente aparece solo con una línea asignada positiva y abre la ficha existente. Al salir del modo teléfono se restauran los nodos originales.

La cámara utiliza `BarcodeDetector` y `getUserMedia` en contexto seguro con permiso del usuario. Si no están disponibles o se deniega el permiso, muestra búsqueda manual. Cada lectura usa `_naProcessScannedCode`, con los controles existentes de códigos, stock y duplicados. Se detienen tracks al cerrar, navegar, ocultar la página, abandonar o cambiar de dispositivo. Los permisos tardíos también se liberan. No se ha probado hardware físico.

Validación ejecutada:

- Pruebas nuevas: 11 E2E, teléfono 320/360/390/430, tablet/PC 768/1024/1366/1920, selector real de cliente, visibilidad de cuenta, VARIOS, lectura única y permiso tardío. Cámara simulada; carrito/productos sintéticos, tráfico externo bloqueado.
- Suite E2E completa: 61 PASS y 4 FAIL en `current-sale-density.spec.ts`, casos 0/1/2/6 productos, altura esperada 36 px frente a 39.59375 px. Los mismos cuatro fallos se reprodujeron sin este cambio en la base indicada; no se cambió esa prueba ni CSS de escritorio.
- 39 pruebas de contratos CANON/arquitectura/seguridad: PASS.
- 20 de 21 pruebas focales de POS: PASS. El fallo `CANON posRender filters visibility without mutating inventory state` es preexistente: su regex `product.stock\s*=` coincide con `product.stock===0` en el archivo sin cambios.
- Sintaxis JS y `git diff --check`: PASS.
- Reviewer/Forensic independiente: P1 del diálogo VARIOS corregido; segunda revisión sin P0/P1 identificados.

Comandos:

```sh
npx playwright test tests/e2e/canon-phone-sale.spec.ts --workers=2
npm run test:e2e -- --workers=3
node --check POS/js/canon-phone-sale.js
git diff --check
```

En el entorno de validación `http-server` falló con `uv_interface_addresses`; se sirvió el mismo árbol con `python -m http.server 4173 --bind 0.0.0.0 --directory POS` antes de Playwright. El repositorio no tiene lockfile raíz: dependencias instaladas con `npm install --no-package-lock --no-audit --no-fund`, sin cambiar package.json.

Rollback: revertir el commit de esta rama. Los nuevos archivos están precacheados para el shell offline; el catálogo/cámara son estado temporal, sin migraciones. Merge y despliegue requieren el flujo de AGENTS.md y sus gates; este documento no certifica publicación.

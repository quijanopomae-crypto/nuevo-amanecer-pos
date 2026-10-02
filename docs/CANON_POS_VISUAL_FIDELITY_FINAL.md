# CANON — fidelidad visual final

Solicitud owner 2026-10-02. Base `a9df5833eaadcf13fc75ff02c69baf52ed17c053`, rama base `feature/v1.3-mobile-cloud`. Primera captura: objetivo; segunda: actual.

Alcance: consolidar CSS CANON, densidad/alineación de categorías reales, cinco columnas desktop, carrito con encabezado Limpiar/cliente, cantidad y precio efectivos mediante estado real del carrito. Mantener drawer y detección de teléfono con sitio de escritorio. Sin deploy, LAB, backend, OUTBOX, persistencia ni datos comerciales.

Impacto: READS categorías/productos/cart, cliente de cobro y estado `localStatus`; WRITES presentación y edición explícita del carrito aún no confirmado. DOM_AFFECTED `pagePOS`; STATE_AFFECTED qty/precio y cliente de la venta en preparación. STORAGE_AFFECTED ninguno nuevo. Invariantes: handlers originales, stock validado por posQty, restricciones de ventas y margen existente, precio efectivo serializado por sale intent; ningún producto se edita. Consumers: checkout normal/rápido y canonical-sale-integration. No tocar su implementación.

Auditoría: dos bloques de reglas contradictorias UI-001/FIDELITY-002; escritorio alternaba auto-fill/cuatro/cinco columnas y categorías de 44/48/52px. Carrito renderizado en cinco columnas, controles repetidos Mayorista/VARIOS y Limpiar en pie. El contrato CANON acepta customer_id y precio efectivo; no acepta nota. Nota excluida hasta aprobación de alcance separado: no crear un campo que descarte contenido al confirmar.

Validación prevista: regresiones focalizadas, controles DOM reales con datos sintéticos, desktop/móvil/sitio escritorio móvil, CANON Critical y E2E Smoke del PR. Rollback: revertir este commit. No modificar interfaz promovida LAB byte-compatible.

Resultado local: 731 regresiones Node PASS, 31 gates de interfaz/paridad PASS, manifiesto backup 2 PASS, SQL snapshot Python PASS y Worker dry-run PASS (sin deploy). Suite Chrome: 16 escenarios E2E, incluyendo capture CANON con cliente/cantidad/precio, pago rápido, stock/margen, Limpiar, VARIOS, Mayorista y navegación. Desktop, 320/360/390/430/768/1024/1366/1920 y emulación Android sitio de escritorio. No equivale a validación física en Android.

El servidor HTTP Python de pruebas bajo carga paralela en Windows produjo conexiones abortadas y scripts incompletos; la suite completa se verificó con un worker. No se cambiaron tests smoke ni reglas comerciales para ocultarlo. La migración D1 local de Wrangler falló con internal error en Windows; se conserva el gate Linux existente de CANON CI para comprobar las mismas migraciones sin cambios.

Consolidación: una regla por selector y breakpoint, eliminadas capas redundantes y breakpoints 979/1200/1500 que competían con 1099/1280; smartphone mantiene su override explícito por screen+pointer. Catálogo conserva datos/imágenes existentes; no se inventaron fotografías. No se modificaron index.html, inline-14 ni assets promovidos LAB, preservando su contrato byte-compatible.

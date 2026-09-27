# CANON — Promoción de interfaz LAB V2

## Diagnóstico confirmado

El shell HTML de LAB y CANON ya era prácticamente el mismo, pero LAB cargaba una capa visual adicional bajo `laboratorio/pos-lab/styles/**` y `animations/**` que CANON no cargaba. Por eso el Worker productivo seguía mostrando la apariencia heredada.

También se comprobó que `POS/js/motion/scroll-motion.js` ya contenía el port productivo del comportamiento móvil, pero no registraba ningún preset automáticamente, por lo que quedaba inactivo.

## Promoción

- Se copia el paquete CSS aprobado a `POS/css/experience-v2/**`.
- Se conserva el mismo orden de carga visual que en LAB.
- No se copia `lab-overrides.css` porque contiene el badge LAB y una regla exclusiva de restauración LAB.
- CANON no depende de rutas `laboratorio/**`.
- El scroll Motion se auto-registra en Clientes, Inventario, Ventas, Caja y Gastos.
- Backend, autoridad, datos y reglas de negocio permanecen sin cambios.

## Rollback

Revertir el PR y redeploy del shell anterior.

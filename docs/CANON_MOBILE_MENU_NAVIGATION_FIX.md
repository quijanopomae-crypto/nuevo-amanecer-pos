# CANON Mobile Menu Navigation Fix

## Problema observado

En el CANON publicado, las tarjetas del menú principal se muestran correctamente en móvil, pero el usuario reportó que tocar el ícono o la tarjeta de Punto de Venta, Inventario, Ventas, Clientes, Caja, Gastos y Configuración no abre el módulo.

## Diagnóstico

El shell actual ya contiene `goPage(id)` y cada tarjeta tiene un `onclick="goPage(...)"`. La navegación base cambia la página activa antes de ejecutar el render pesado, por lo que el problema no está en la ausencia de `goPage`.

La entrada desde el menú depende de un único mecanismo frágil: handlers inline sobre cada `.module-card`. Para robustecer móvil/PWA sin cambiar el DOM aprobado de LAB ni las reglas comerciales, CANON añadirá un controlador externo de navegación por delegación de eventos.

## Cambio

Añadir `POS/js/navigation/menu-navigation.js`:

- captura toques sobre cualquier descendiente de `.module-card`;
- activa únicamente los 7 destinos allowlisted;
- en touch/pen usa pointerdown/pointerup y descarta gestos de scroll;
- suprime el click sintético posterior al touch para evitar doble navegación;
- en mouse usa click delegado;
- añade soporte de teclado Enter/Espacio;
- no accede a storage, red, ventas, caja, créditos ni persistencia.

El HTML de las tarjetas no cambia para mantener la paridad LAB→CANON existente.

## Aceptación

- tocar ícono, título, descripción, flecha o fondo de la tarjeta abre el módulo correcto;
- los 7 módulos quedan cubiertos;
- un desplazamiento vertical sobre una tarjeta no dispara navegación;
- un toque no ejecuta `goPage` dos veces;
- el script queda cargado y precacheado por el Service Worker;
- CANON Critical CI permanece verde.

## Rollback

Revertir el commit/PR. No hay migraciones ni cambios de datos.

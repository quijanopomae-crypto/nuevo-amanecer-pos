# CANON Navigation Performance Root Fix

## Causa observada

La navegación heredada activa una página y, dentro de la misma llamada, ejecuta su renderer completo antes de devolver el control al navegador. Adicionalmente, cada evento `na:canonical-updated` reconstruye POS, Inventario, Dashboard y Clientes aunque esos módulos estén ocultos.

En Clientes, el renderer final calcula estado y deuda por cliente mediante recorridos repetidos de `creditos[]`, y Clientes V2 vuelve a consultar los créditos de cada cliente al crear sus tarjetas.

## Corrección

1. Activar la página inmediatamente.
2. Ceder un paint al navegador.
3. Renderizar únicamente la página activa.
4. En eventos CANON, actualizar el snapshot y refrescar solo la vista visible.
5. Construir una vez por render un índice derivado de créditos por cliente y reutilizarlo.

No se modifica negocio, persistencia, autoridad, D1 ni UI V2.

# CANON LIVE Customers — customer.create

## Objetivo

Migrar **Nuevo cliente** desde la persistencia legacy a la autoridad CANON:

modal existente -> canonical-client -> Worker -> D1 -> lectura CANON -> Clientes/POS.

## Decisión de arquitectura

La tabla `customers` es el snapshot importado y permanece inmutable.

Los clientes creados después del cutover viven en `canonical_live_customers`. Las lecturas exponen un catálogo lógico IMPORT + LIVE.

Las tablas operativas que históricamente tenían FK directa a `customers` se reconstruyen preservando todas sus filas y sustituyen esa FK por triggers de integridad contra el catálogo efectivo IMPORT + LIVE. Así:

- no se fabrica provenance;
- no se inserta staging falso;
- un cliente LIVE puede participar en ventas y créditos;
- el snapshot importado sigue sellado.

## Alcance

Esta etapa implementa **customer.create**. La UI actual no tiene un flujo canónico de edición de cliente, por lo que `customer.update` queda fuera de alcance.

## Invariantes

1. `customers` importado no se modifica.
2. `customer.create` requiere CANON ACTIVE + writer autenticado.
3. customer_id no puede colisionar IMPORT/LIVE.
4. DNI/documento no vacío no puede colisionar IMPORT/LIVE.
5. Mismo operation_id + mismo payload = replay; payload distinto = conflict.
6. Cliente LIVE debe poder usarse en:
   - venta normal;
   - venta a crédito;
   - cuenta de crédito.
7. No existe `saveAllData()` en el path CANON.
8. ACK perdido conserva la misma operación pendiente.
9. Rechazo definitivo conocido puede limpiar solo ese journal; timeout/5xx no.
10. La revisión activa cambia al crear un cliente para invalidar cursores/caché.

## Compatibilidad de migración

El Worker debe seguir leyendo/vendiendo con el esquema pre-0017 mientras la migración aún no se aplicó. Las rutas LIVE solo se habilitan cuando `canonical_live_customers` y `canonical_customer_operations` existen.

## Pruebas mínimas

- alta D1;
- F5;
- segundo dispositivo;
- DNI duplicado IMPORT/LIVE;
- lost ACK;
- refresh después de commit;
- venta con cliente LIVE;
- crédito con cliente LIVE;
- cuenta de crédito para cliente LIVE;
- preservación de filas operativas preexistentes;
- Critical + Mirror + E2E.

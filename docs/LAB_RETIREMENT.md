# Retiro controlado de POS-LAB

## Decisión

El POS-LAB permanente queda retirado como entorno funcional de desarrollo.

La razón principal es evitar:

- dos copias del producto;
- drift LAB/CANON;
- promociones manuales;
- gates duplicados;
- resultados que pasan en LAB pero fallan al integrarse en CANON.

El reemplazo es el flujo de ramas + Draft PR + CI + preview temporal del mismo SHA.

## Clasificación

### ELIMINAR del flujo activo

- publicación GitHub Pages de POS-LAB;
- deploy/refresh remoto específico de LAB;
- LAB Canon Mirror CI como gate del producto;
- roles/comandos/skills de escritura LAB;
- entrypoints y scripts que levantan el POS-LAB como segunda aplicación.

### CONSERVAR

- `POS/**`;
- `tests/**`;
- `infra/database/migrations/**`;
- harnesses de navegador, outbox, idempotencia y rendimiento;
- `tools/cloudflare-backup/**`;
- código backend que hoy usa CANON/producción aunque viva bajo `tools/cloudflare-lab/**`.

### HISTÓRICO / READ-ONLY

Los Task Contracts, preflights, snapshots y documentación LAB antiguos pueden mantenerse como evidencia hasta una limpieza documental posterior.

No se vuelven a usar como gates activos.

## Advertencia sobre tools/cloudflare-lab

El nombre del directorio es histórico. El árbol contiene actualmente piezas que CANON/producción todavía usa, incluyendo Worker/harnesses.

Por tanto:

**NO BORRAR NI RENOMBRAR `tools/cloudflare-lab/**` dentro de este retiro.**

Separarlo o renombrarlo será otra migración, con diff propio, CI y verificación productiva.

## Criterio de retiro seguro

El LAB activo se considera retirado cuando:

1. no existe workflow automático/manual que publique o despliegue POS-LAB;
2. CANON Critical cubre las regresiones relevantes que antes vivían en LAB Mirror;
3. el mapa del repo y agentes ya no dirigen trabajo nuevo a LAB;
4. el runtime CANON no depende de `laboratorio/**`;
5. las pruebas que dependían solo de workflows LAB se retiran o migran;
6. el cambio pasa CI en una rama aislada.

## Rollback

Todo el retiro se hace en una rama y PR independientes.

Si aparece una dependencia inesperada:

- no se fuerza el borrado;
- se restaura el archivo desde Git;
- se clasifica la dependencia;
- se migra primero;
- se vuelve a intentar el retiro.

No se borra historial Git.

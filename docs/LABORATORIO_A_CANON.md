# Laboratorio -> CANON — política de promoción

## Propósito

Permitir experimentar rápido sin convertir el POS estable en área de pruebas.

Esta política gobierna el código del producto y no reemplaza los estados de datos canónicos definidos por V1.3 A6.

## Zonas

- **LABORATORIO**: `laboratorio/` + rama `lab/<nombre>`. Puede romperse.
- **CANON de producto**: `POS/`. Solo recibe cambios aprobados.
- **Producción comercial**: despliegue autorizado del CANON. Nunca se usa para experimentar.
- **Cloudflare lab existente**: `tools/cloudflare-lab/`. Sigue siendo laboratorio de infraestructura y no se mezcla con prototipos generales del POS.

## Flujo obligatorio

```text
IDEA
 -> rama lab/<nombre>
 -> laboratorio/experimentos/<ID>
 -> prueba con datos sintéticos
 -> LAB_BOUNDARY_PASS
 -> pruebas funcionales
 -> revisión de diff
 -> CANDIDATO_A_CANON
 -> parche mínimo sobre POS/
 -> pruebas de regresión
 -> aprobación
 -> merge
 -> despliegue separado
```

## Gates de promoción

Un candidato solo puede entrar a CANON cuando:

1. el comportamiento esperado está definido;
2. las pruebas relevantes pasan;
3. no contiene secretos ni datos comerciales;
4. CANON no depende en runtime de `laboratorio/`;
5. el diff se revisó completo;
6. no reemplaza archivos canónicos completos si basta un cambio localizado;
7. existe rollback por commit/revert;
8. cualquier cambio de datos, reglas comerciales o seguridad tiene autorización explícita del propietario.

## Anti-destrucción

- Nunca copiar todo `laboratorio/` sobre `POS/`.
- Nunca borrar CANON para instalar una prueba.
- Nunca reutilizar almacenamiento, credenciales o bases de producción para experimentar.
- Nunca promover archivos no usados por el cambio aprobado.
- Nunca considerar PASS solo porque “abre”; validar persistencia y regresiones relacionadas.
- Si el primer enfoque falla de forma real, diagnosticar antes de repetir cambios.

## Resultado de un experimento

Solo existen tres salidas:

- `DESCARTAR`: no toca CANON.
- `ITERAR`: permanece en LAB.
- `CANDIDATO_A_CANON`: habilita revisión; todavía no es producción.

La aprobación promueve el cambio funcional mínimo, no el directorio experimental completo.

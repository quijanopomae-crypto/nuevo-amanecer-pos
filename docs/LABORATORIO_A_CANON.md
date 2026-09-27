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
 -> prueba local/unitaria con datos sintéticos
 -> integración autorizada puede usar copia real aislada en D1 LAB
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
3. no contiene secretos ni datos comerciales reales versionados, incrustados o publicados;
4. CANON no depende en runtime de `laboratorio/`;
5. el diff se revisó completo;
6. no reemplaza archivos canónicos completos si basta un cambio localizado;
7. existe rollback por commit/revert;
8. cualquier cambio de datos, reglas comerciales o seguridad tiene autorización explícita del propietario.

## Anti-destrucción

- Nunca copiar todo `laboratorio/` sobre `POS/`.
- Nunca borrar CANON para instalar una prueba.
- Nunca reutilizar almacenamiento, credenciales o bases de producción para experimentar. D1 LAB aislada no es producción y puede recibir únicamente la copia CANON autorizada.
- Nunca promover archivos no usados por el cambio aprobado.
- Nunca considerar PASS solo porque “abre”; validar persistencia y regresiones relacionadas.
- Si el primer enfoque falla de forma real, diagnosticar antes de repetir cambios.

## Resultado de un experimento

Solo existen tres salidas:

- `DESCARTAR`: no toca CANON.
- `ITERAR`: permanece en LAB.
- `CANDIDATO_A_CANON`: habilita revisión; todavía no es producción.

La aprobación promueve el cambio funcional mínimo, no el directorio experimental completo.


## Promoción visual determinista

La capa visual aprobada ya no debe copiarse manualmente archivo por archivo.

Fuente de promoción:
- estilos LAB: `laboratorio/pos-lab/styles/**`;
- animaciones CSS LAB: `laboratorio/pos-lab/animations/**`;
- mirror CANON: `POS/css/experience-v2/**`;
- allowlist única: `tools/pos-experience/visual-assets.mjs`.

Comprobación segura, sin escrituras:

```bash
node tools/pos-experience/promote-lab-visuals.mjs --check
```

Después de que el owner apruebe un candidato concreto, la promoción visual se ejecuta con:

```bash
node tools/pos-experience/promote-lab-visuals.mjs --write --owner-approved
```

El modo write solo puede copiar los assets de la allowlist a `POS/css/experience-v2/**`; no copia `index.html`, `lab-overrides.css`, JavaScript LAB, datos ni infraestructura.

El JavaScript Motion no se trata como copia byte-a-byte porque LAB y CANON tienen namespaces y lifecycles distintos. Su equivalencia se valida mediante los tests CANON de bootstrap, lazy bridge y contrato UI.

CANON Critical CI y Hosted POS Deploy ejecutan `--check` y fallan cerrado ante drift, orden CSS incorrecto o precache PWA incompleto.

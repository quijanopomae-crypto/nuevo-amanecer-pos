# STAGING CANON

STAGING CANON es un entorno aislado para validar el mismo POS antes de producción.

## Recursos

- Web Worker: `nuevo-amanecer-pos-web-staging`
- Backend Worker: `nuevo-amanecer-pos-staging`
- D1: `nuevo-amanecer-staging`
- R2: `nuevo-amanecer-staging-artifacts`
- Binding neutral: `DB`
- Datos: exclusivamente sintéticos

## Despliegue

La existencia de este directorio o el merge del workflow **no despliega nada**. El workflow
`.github/workflows/staging-deploy.yml` solo se activa cuando el owner fusiona un
`ops/staging-deploy-trigger.json` autorizado con un `target_head` exacto.

El workflow:

1. crea o reutiliza únicamente los recursos STAGING;
2. aplica las migraciones neutrales;
3. carga el baseline sintético;
4. activa la autoridad sintética y restaura inmediatamente el guard CANON;
5. despliega backend y frontend STAGING;
6. genera un secreto de activación exclusivo y efímero para STAGING;
7. comprueba health, sesión, lecturas CANON, cierre de rutas LAB y runtime-config;
8. escribe solo un marcador sintético en R2 STAGING.

No copia, exporta ni consulta datos de producción.

## Seguridad

Las plantillas siguen sin ser desplegables directamente: el backend conserva
`__STAGING_D1_DATABASE_ID__` hasta que el workflow descubre/crea la D1 aislada y genera
una configuración temporal validada. El endpoint PROD no forma parte del artefacto POS
compartido.

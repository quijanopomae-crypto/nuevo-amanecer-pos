# Animaciones LAB → CANON: migración y pulido

Solicitud del propietario: migrar las animaciones de laboratorio a CANON y pulirlas. Zona de implementación: CANON. Base recuperable: `955b07c`, con las mejoras de crédito y abonos ya publicadas.

## Candidato y alcance

El candidato es la capa visual LAB V2 ya aprobada y sus controles de movimiento: entradas de módulos, scroll nativo con bandas secundarias, detalle de Clientes, feedback del carrito, notificaciones y entradas de modales. Estado: CANDIDATO_A_CANON; la solicitud actual autoriza su promoción y pulido. Las 23 hojas de estilo ya están reflejadas en CANON sin drift. La migración pendiente se concentra en activación y lifecycle del JavaScript.

No se copia la herramienta administrativa `naLabWorkspaceOverlay`: es una función exclusiva del entorno LAB. Su patrón visual de gesto ya tiene la implementación CANON reutilizable en modal-motion y en el detalle de Clientes.

## Comportamiento final

- Entrada de módulos con la clase CANON que realmente existe, en móvil y escritorio, después del primer pintado y sin forzar layout.
- Activación perezosa del scroll por módulo, respetando navegación segura, scroll nativo y movimiento reducido. No inicializar todos los módulos al cargar.
- Reinicios de feedback sin lecturas síncronas de geometría; evitar animaciones acumuladas o callbacks de páginas que ya se cerraron.
- Duraciones breves y coherentes en entradas, carrito, notificaciones y modales; conservar el estilo LAB. Los valores confirmados de crédito y abonos se actualizan inmediatamente.
- Los modales y gestos siguen siendo visuales: nunca confirman operaciones, modifican datos ni autorizan acciones.
- Ninguna dependencia runtime de rutas laboratorio; soporte de movimiento reducido y degradación estática si Motion falla.

## Archivos permitidos

`POS/js/motion/**`, `POS/css/motion/**`, `POS/index.html`, `POS/sw.js`, `docs/MOTION_MAP.yaml`, este contrato, pruebas CANON Motion/paridad relacionadas y un verificador visual aislado bajo `tools/pos-experience/`. No se modifica `laboratorio/**`, backend, autenticación ni reglas comerciales.

## Verificación y rollback

LAB: boundary check y 27 pruebas de movimiento aprobados; build verificado desde una copia del commit exportada por Git, normalizando exclusivamente CRLF a LF. El generador elimina el LF terminal de cada sección pero conserva su CR, produciendo ocho CR adicionales; sin CR, la salida es idéntica. No se altera la fuente LAB para esta promoción.

CANON: pruebas de activación/lifecycle, paridad visual, reduced-motion, navegación, geometría y runtime en Chromium móvil/escritorio. Revisar errores de consola, layouts síncronos, gestos, reentradas y módulos. Ejecutar regresiones de créditos/abonos y comprobar caché PWA de los assets.

Rollback: revertir solamente los commits de esta promoción y publicar el frontend anterior `008627a8-39b5-4f8f-8cc6-47ecdc0e712c`. No revertir las mejoras de velocidad ni modificar el backend.

## Resultados verificados

- 43 pruebas CANON de movimiento, paridad y navegación: aprobadas. Las comparaciones de texto normalizan CRLF/LF sin omitir contenido.
- 488 pruebas cloud-sync: aprobadas; se conservan las mejoras de créditos y abonos.
- `node tools/pos-experience/promote-lab-visuals.mjs --check`: 23 assets sin drift.
- `node tools/pos-experience/verify-canon-motion.mjs`: Chrome real, contextos locales aislados a 390 y 1280 píxeles; cinco módulos, entrada efectiva, scroll nativo, cambio dinámico de movimiento reducido, modal y gesto de retorno, toast, carrito, navegación rápida y recreación de controladores. Sin errores JavaScript. Capturas bajo `outputs/canon-motion/`, no versionadas.
- `git diff --check`: aprobado. No cambios LAB, backend ni datos comerciales.

Se elimina un separador literal `\\n` entre scripts de CANON que aparecía como texto en la pantalla. La capa CSS propia se carga después del espejo LAB y se incluye en el precache PWA. Esta promoción se entrega en una PR independiente sobre la rama que contiene las correcciones financieras; no constituye un despliegue de producción.

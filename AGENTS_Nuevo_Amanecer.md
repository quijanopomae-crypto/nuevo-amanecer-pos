# AGENTS_Nuevo_Amanecer.md — Sistema POS Nuevo Amanecer

## Misión

Desarrolla, estabiliza y mantiene el **Sistema POS Nuevo Amanecer** para Multiservicios Nuevo Amanecer, ubicado en Puerto Súngaro, provincia de Puerto Inca, región Huánuco, Perú.

El sistema debe funcionar en teléfonos Android, tablets, computadoras y laptops mediante navegadores modernos, principalmente Chrome, Edge y Chromium.

El objetivo es entregar un sistema comercial estable, rápido, claro, seguro dentro de las limitaciones de una aplicación web local, resistente a pérdida o duplicación de datos y preparado para crecer.

## Fuentes de verdad

Aplica este orden:

1. Solicitud explícita actual del propietario.
2. Capturas y ejemplos entregados para esa solicitud.
3. `AGENTS.md` de la raíz, que define el modo normal/LAB/shadow y la frontera CANON.
4. Este archivo `AGENTS_Nuevo_Amanecer.md`, para reglas funcionales y de seguridad.
5. La especificación o contrato durable aplicable dentro de `docs/` o `laboratorio/pos-lab/tasks/`.
6. Último comportamiento estable aprobado.
7. Código actual del repositorio.

Cuando exista contradicción, no adivines ni borres comportamiento estable. Documenta la contradicción y solicita una decisión solo cuando afecte datos, reglas comerciales, seguridad o cambios irreversibles.

## Rol de Codex

Trabaja con disciplina de:

- Arquitectura de software.
- JavaScript, HTML, DOM y CSS responsive.
- UX/UI para sistemas comerciales.
- POS, inventario, ventas, pagos, caja y créditos.
- Persistencia y migraciones.
- Seguridad de aplicaciones web.
- Control de calidad y pruebas.
- Git y control de versiones.

Sé creativo para resolver problemas, pero no conviertas una corrección pequeña en un rediseño ni añadas funciones no solicitadas.

## Regla de la fuente principal

- Trabaja sobre una sola rama y una sola versión principal.
- Antes de editar, confirma archivo, commit y estado de Git.
- Crea respaldo o commit recuperable.
- No generes una cadena de archivos `v1`, `v2`, `v48`, `v49` para cada parche.
- El archivo probado debe ser exactamente el archivo entregado.

## Flujo obligatorio

1. **Comprender:** define resultado esperado, resultado actual, alcance y riesgos.
2. **Inspeccionar:** localiza HTML, CSS, JavaScript, eventos, estado y almacenamiento relacionados.
3. **Reproducir:** demuestra el fallo antes de corregir cuando sea posible.
4. **Respaldar:** crea commit, rama o copia recuperable.
5. **Implementar:** aplica el cambio mínimo, sin modificar módulos no relacionados.
6. **Probar:** caso principal, casos límite, recarga, datos antiguos, consola, teléfono y computadora.
7. **Revisar:** inspecciona el diff y busca regresiones.
8. **Informar:** diagnóstico, causa, archivos, funciones, pruebas, resultado y pendientes.

No afirmes que algo se probó si no se ejecutó realmente.

## Auditoría y estabilización

Cuando la tarea autorice **auditar y parchear**, primero ejecuta la auditoría técnica y de seguridad.

Clasifica hallazgos:

- Crítico.
- Alto.
- Medio.
- Bajo.
- Preventivo.

Puedes parchear inmediatamente hallazgos críticos o altos que provoquen pérdida/corrupción de datos, duplicación de ventas o cobros, inyección, borrado no autorizado, inconsistencia entre venta/stock/caja o bloqueo total, siempre que la corrección sea localizada y verificable.

Detente y reporta antes de:

- Borrar o migrar datos de manera irreversible.
- Cambiar reglas comerciales.
- Rediseñar módulos completos.
- Añadir backend o servicios externos.
- Hacer una refactorización extensa.
- Tomar una decisión cuyo comportamiento esperado no esté definido.

Consulta `docs/05_AUDITORIA_SEGURIDAD_ISHIKAWA.md`.

## Regla Ishikawa

Activa Ishikawa cuando:

- La auditoría no demuestra la causa.
- El primer parche falla.
- El mismo tipo de error aparece dos veces.
- Una corrección reintroduce un error.
- Funciona en PC pero no en teléfono.
- El bug es intermitente.
- Los datos desaparecen al recargar.
- Existen versiones, funciones o CSS contradictorios.
- Se entra en un bucle de parches.

Procedimiento:

1. Congela cambios.
2. Confirma versión exacta.
3. Reproduce y documenta.
4. Define un problema central verificable.
5. Analiza código, DOM, CSS, eventos, datos, almacenamiento, entorno, versiones, requisitos y pruebas.
6. Formula hipótesis verificables.
7. Cambia una sola variable por experimento.
8. Confirma la causa raíz con evidencia.
9. Aplica los cinco porqués.
10. Corrige la causa raíz.
11. Crea una prueba de regresión.
12. Cambia el proceso que permitió que el error naciera.

No simules reuniones, subagentes ni pruebas. Usa agentes paralelos solo cuando estén disponibles y las tareas estén aisladas.

## Seguridad mínima

- No insertes datos de usuario o importados con `innerHTML`, `outerHTML`, `insertAdjacentHTML` o `document.write` sin sanitización estricta.
- Prefiere `textContent`, `createElement` y atributos validados.
- Bloquea doble clic y reintentos en operaciones críticas.
- Usa IDs únicos y verificación de duplicados.
- Mantén consistencia entre venta, stock y caja.
- Una falla de impresión no debe borrar una venta.
- Valida estructura, tamaño, tipos, duplicados, rangos y contenido de importaciones.
- Ocultar un botón no equivale a autorización; valida también en la lógica.
- No guardes PIN, contraseñas, tokens o claves privadas en texto visible.
- No prometas seguridad absoluta, sincronización o Bluetooth nativo si la arquitectura no lo permite.

## Reglas de interfaz

Cuando una captura sea referencia exacta:

- Respeta orden, columnas, agrupaciones, tamaños relativos y visibilidad.
- No la uses solo como inspiración.
- No agregues opciones visibles no solicitadas.
- No conviertas todas las filas en una columna mediante una media query general.
- Prueba teléfono y computadora.

“Nuevo producto” y “Editar producto” deben compartir el mismo componente, HTML, CSS, validaciones y modelo de datos. Solo cambian título, valores y acción.

## Reglas funcionales esenciales

- Búsqueda POS por nombre, marca, SKU, código principal y códigos alternativos.
- Pago: efectivo, Yape, Plin, transferencia, crédito y mixto.
- Los botones de efectivo establecen el monto; no lo acumulan.
- Cada producto admite un código principal y hasta diez códigos de barras alternativos.
- La fila vacía de código alternativo puede existir en la UI, pero no se guarda.
- Datos principales deben persistir; no depender solo de variables en memoria.
- Venta, stock y caja deben actualizarse una sola vez.
- Ticket e impresión son posteriores al registro de venta.

## Responsive

Prueba como mínimo: 320, 360, 390, 430, 768, 1024, 1366 y 1920 px.

En teléfono: sin cortes, sin scroll horizontal innecesario, scroll vertical funcional, modales accesibles y teclado sin ocultar acciones.

En computadora: aprovecha el ancho sin estirar excesivamente inputs ni dejar zonas vacías gigantes.

## Prohibiciones

No:

- Uses una versión antigua sin avisar.
- Rehagas todo por una corrección pequeña.
- Cambies módulos no relacionados.
- Borres datos para ocultar errores.
- Desactives validaciones para que “funcione”.
- Crees IDs o funciones globales duplicadas.
- Bloquees el scroll.
- Prometas sincronización sin backend.
- Prometas hardware no demostrado.
- Entregues sin revisar el diff.
- Continúes generando versiones durante un bucle de regresión.

## Definición de terminado

Una tarea termina solo cuando:

- Cumple el comportamiento solicitado.
- Guarda y persiste cuando corresponde.
- No genera errores nuevos en consola.
- No rompe módulos relacionados.
- Funciona en el entorno relevante.
- Respeta la referencia visual.
- Mantiene scroll y acciones accesibles.
- Valida entradas.
- Incluye prueba de regresión si corrige un bug.
- Documenta cambios, pruebas y riesgos.

## Documentos obligatorios

Lee solo los documentos que existen y aplican a la tarea; no inventes rutas ausentes.

Siempre:
- `README.md`
- `AGENTS.md`
- este archivo `AGENTS_Nuevo_Amanecer.md`

Para LAB:
- `laboratorio/README.md`
- `laboratorio/LAB_POLICY.json`
- `docs/LABORATORIO_A_CANON.md`
- `docs/LAB_CANON_MIRROR.md`
- el contrato de tarea bajo `laboratorio/pos-lab/tasks/`

Para V1.3 CANON/cloud, lee la especificación V1.3 aplicable existente en `docs/` (A2, A3, A4, A5, A6 o Gate P según el alcance).

Para V1.2/recovery, usa los documentos `docs/V1.2_*.md` existentes solo cuando esa versión o recuperación sea relevante.

Si descubres comandos reales para ejecutar o probar, documéntalos en `README.md`. No inventes comandos ni documentos.

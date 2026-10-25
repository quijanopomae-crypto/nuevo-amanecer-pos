# Desarrollo proporcional al riesgo — plan y alcance autorizado

Goal: aplicar la misión explícita del propietario del 25/10/2026 sin repetir autorizaciones.
Architecture: política común Markdown, manifiesto de publicación validado con Git y CI, cambios WORK separados.
Spec: solicitud del propietario en esta sesión. Ejecución directa autorizada; no cutover ni cambios de secretos.

- [ ] Política: tres riesgos; revisión automatizada independiente válida; sin dependencia de un agente nominal.
- [ ] Release: pruebas negativas de manifiesto, diferencia completa desde producción, target exacto, CI y rollback; preparar con un comando y desplegar solo mediante PR.
- [ ] WORK: revisar #1047; reproducir defectos de sesión/navegación/puente y probar sin escrituras reales; publicación condicionada a verificaciones reales disponibles.
- [ ] Revisión independiente del diff final; PR, checks, merge si pasan; verificación de publicación o bloqueo concreto.

Review focus: alcance acumulado, CI ausente/obsoleta, referencias no ancestrales, sesión no confirmada, filtración a empleado.

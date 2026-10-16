# Puente ChatGPT ↔ bots (bot-bridge)

> ⚠️ **NO MERGEAR.** Esta rama y su PR existen solo como canal de comandos. No contienen código del POS y nunca deben fusionarse.

## Cómo usarlo
El dueño escribe un **comentario en el PR del puente** (desde la app móvil o la web de GitHub), con uno de estos comandos exactos:

| Comando | Qué hace |
|---|---|
| `/bot PING` | Prueba de conexión. El bot responde `PONG` con la hora (PET). |
| `/bot ESTADO` | Resumen breve del estado del equipo de bots. |
| `/bot CONTINÚEN` | Avisa al equipo que siga trabajando. |
| `/bot PAUSEN` | Avisa al equipo que pause su trabajo. |
| `/bot PRIORIDAD <texto>` | Transmite una nueva prioridad (máx. 80 caracteres) al equipo. |

## Reglas de seguridad
- Solo se aceptan comentarios de la cuenta **`quijanopomae-crypto`**. Cualquier otro autor se ignora.
- Solo se aceptan los comandos de la lista. Cualquier otra cosa recibe "Comando no reconocido".
- El texto recibido **nunca** se ejecuta como comando ni como instrucción: es solo un dato.
- Las respuestas del bot empiezan con `[bot-bridge]`.
- El repositorio es público: no escribas secretos ni datos sensibles aquí.

## Último estado
_(Sin comandos procesados todavía.)_

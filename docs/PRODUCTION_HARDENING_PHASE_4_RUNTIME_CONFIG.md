# Production hardening — Fase 4A: configuración hospedada por entorno

## Problema eliminado
Los assets compartidos del POS y el launcher contenían el endpoint del Worker PROD. Copiarlos a STAGING podía conectar accidentalmente el entorno de pruebas con producción.

## Contrato nuevo
El Worker web sirve `/runtime-config.js` con `Cache-Control: no-store`. La respuesta solo contiene:
- `environment`: production o staging;
- `apiOrigin`: endpoint HTTPS exacto del backend de ese entorno;
- `hostedHost`: host que sirvió la configuración.

No contiene secretos.

El launcher y el POS cargan esa configuración antes de la activación/guard. En un host hospedado del proyecto, una configuración ausente o inválida bloquea la aplicación y redirige al launcher; nunca habilita modo local silencioso.

## Preparación para build-once
Los assets compartidos ya no contienen el endpoint PROD, por lo que el mismo artefacto POS puede promoverse entre STAGING y PROD. La diferencia queda en variables del Worker web, fuera del artefacto estático.

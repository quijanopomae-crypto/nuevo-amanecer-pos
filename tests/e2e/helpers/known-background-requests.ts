// Pedidos de fondo que NO son escrituras de la pantalla probada.
// Ping del asistente: POST /auth/assistant/chat con cuerpo exacto {"ping":true}. Solo pregunta si este aparato tiene el asistente
// (no llama al modelo ni guarda nada). Cualquier otro POST al asistente sigue contando como escritura.
type Req = { method(): string; url(): string; postData(): string | null };

export function isAssistantPing(request: Req): boolean {
  try {
    return request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/auth/assistant/chat') && request.postData() === '{"ping":true}';
  } catch {
    return false;
  }
}

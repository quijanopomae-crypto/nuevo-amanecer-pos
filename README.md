# POS Nuevo Amanecer — V1.2

**V1.2 PRODUCTION READY** — release `v1.2-production`.

Estado verificable y gates de cierre: [docs/V1.2_STATUS.md](docs/V1.2_STATUS.md).
Puesta en marcha y datos existentes: [docs/V1.2_USO.md](docs/V1.2_USO.md).

En Windows con Node.js, ejecutar `INICIAR_POS.cmd`. El iniciador abre la dirección
estable `http://127.0.0.1:8788/POS/index.html`, necesaria para usar también OCR.
Mantener un solo PC escritor y una sola pestaña de escritura.

Para guardar la clave vigente en ese navegador, abrir
`http://127.0.0.1:8788/tools/pos-local/setup.html`. La página comprueba la credencial
sin registrar ventas. No enviar claves por mensajes ni incluirlas en el paquete.

Inicio manual desde la raíz del paquete:

```powershell
node tools/pos-local/server.mjs
```

Prueba focal del iniciador desde el repositorio de desarrollo:

```powershell
node --test tests/release-local-server.test.mjs
```

No cambiar el origen de una caja existente sin exportar y comprobar antes el respaldo
completo. El paquete no contiene los datos comerciales ni las credenciales.

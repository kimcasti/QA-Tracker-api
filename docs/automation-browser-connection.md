# Conectar Playwright con QA Tracker

La conexión se autoriza en el navegador y queda asociada a una carpeta local, un usuario, una API de QA Tracker y un proyecto. Cambiar de proyecto en la interfaz no cambia el destino del script.

## Primera conexión

Arranca la API y el frontend de QA Tracker local. En `lpas/client/qa-automation/.env` configura únicamente el destino (no pegues un JWT nuevo):

```dotenv
QA_TRACKER_API_URL=http://127.0.0.1:1337
QA_TRACKER_WEB_URL=http://localhost:3000
QA_TRACKER_PROJECT_KEY=LPAS-MN2I3K63-2Z34
```

Desde `lpas/client`:

```sh
npm --prefix qa-automation run qa:connect
```

Se abre `/automation/connect`. Inicia sesión si es necesario, compara el código con tu terminal, selecciona LPAS y pulsa **Autorizar conexión**. El comando espera hasta diez minutos. Autorizar no ejecuta pruebas ni crea ejecuciones o tickets.

Si el navegador no abre, copia el enlace mostrado. También puedes usar `npm --prefix qa-automation run qa:connect -- --no-browser`.

Después usa los mismos comandos:

```sh
npm --prefix qa-automation run qa:status
npm --prefix qa-automation run test:local:publish
# O contra LPAS en test:
npm --prefix qa-automation run test:test:publish
# O publica un JSON ya generado (crea otra ejecución salvo ID explícito):
npm --prefix qa-automation run publish:results
```

`PLAYWRIGHT_LOCAL_BASE_URL` / `PLAYWRIGHT_TEST_BASE_URL` determinan dónde se prueba LPAS. `QA_TRACKER_API_URL` determina dónde se guardan los resultados. Son independientes. `QA_TRACKER_ENVIRONMENT`, si se define, debe coincidir con el ambiente probado; si se omite se usa `PLAYWRIGHT_ENV`.

## Otro proyecto o equipo

En otra carpeta ejecuta `qa:connect` y autoriza el proyecto correspondiente. Si esa carpeta conserva `QA_TRACKER_PROJECT_KEY`, debe coincidir con el proyecto autorizado. Una discrepancia cancela la conexión y la revoca, para evitar publicaciones accidentales.

Para cambiar el destino de una carpeta existente:

```sh
npm --prefix qa-automation run qa:disconnect
# Ajusta API, web y project key en la configuración.
npm --prefix qa-automation run qa:connect
```

Mover/renombrar una carpeta requiere conectarla de nuevo. Revoca la conexión anterior desde el menú de usuario → **Conexiones de automatización**. Puedes revocar desde allí también si pierdes el equipo. El comando `qa:disconnect` revoca en servidor antes de borrar la copia local; si no hay red conserva la copia para poder reintentar.

## Producción

Primero despliega estos cambios de API y frontend juntos. Configura las URLs HTTPS reales en el `.env` de automatización y autoriza desde esa instancia. Si las URLs o el proyecto difieren de la conexión guardada, el publicador se detiene. La configuración CORS de la API debe permitir el frontend correspondiente. No se ha desplegado esta funcionalidad automáticamente.

## Seguridad e implementación

- Credencial aleatoria de 256 bits con prefijo `qat_`; base de datos guarda solo SHA-256. La solicitud pasa de pendiente (10 minutos) a activa (90 días) con una única actualización condicional. El secreto permanece en el proceso local hasta guardarlo; no pasa por el navegador.
- Código visible independiente, aleatorio de 64 bits, de uso único. Confirmación explícita del usuario y del proyecto. Este es un protocolo interno de emparejamiento; no se presenta como un servidor OAuth estándar. La separación entre autorización en navegador y sondeo toma como referencia [RFC 8628](https://www.rfc-editor.org/rfc/rfc8628.html).
- Solo `/api/automation-client/open-run` y `/publish-results` aceptan la credencial para publicar. Ambas rutas comprueban usuario activo, membresía/rol actuales y proyecto de destino; incluso al reutilizar una ejecución existente.
- Los endpoints de gestión verifican el JWT real del usuario y la propiedad de la conexión. Nunca aceptan una credencial de automatización como sesión. La autorización exige rol de ingeniería en la organización del proyecto.
- En Windows se guarda cifrada con DPAPI para el usuario actual, fuera del repo: `%LOCALAPPDATA%/qa-tracker/connections/<hash-de-la-carpeta>.json`. En macOS/Linux se guarda fuera del repo con directorio `0700` y archivo `0600`; allí no hay cifrado de sistema implementado.
- Sin conexión guardada sigue disponible el flujo anterior con `QA_TRACKER_TOKEN`. Una conexión inválida nunca provoca un cambio silencioso a ese JWT.
- URLs HTTPS obligatorias excepto localhost; sin redirecciones al enviar credenciales. No se registran tokens. Límites de solicitudes por IP/proceso (6 solicitudes, 10 aprobaciones, 60 sondeos por minuto). En despliegues con varias réplicas, aplica además límites compartidos en el proxy de entrada.
- Nueva tabla `automation_connections`, sin alterar columnas de proyectos existentes y sin rutas CRUD públicas del modelo. Las conexiones expiradas se limpian al iniciar una solicitud nueva.
- Esta conexión no autoriza crear tickets en Jira; el flujo de vista previa y creación manual sigue separado.

## Validación

Pruebas de backend: aislamiento de proyecto en ambos endpoints, revocación/caducidad, usuario bloqueado, pertenencia a organización, repetición de aprobación y propiedad al revocar. Pruebas del script: cifrado DPAPI real en Windows, aislamiento por carpeta, publicación sin JWT a receptor aislado y rechazo de cambios de destino antes de enviar. Prueba HTTP local y prueba con Chromium sobre la pantalla real: comando → selección del proyecto y aprobación → guardado cifrado → revocación desde la interfaz → credencial rechazada. Estas verificaciones no crearon ejecuciones ni tickets en servicios reales. Pasaron las 72 pruebas de backend, las 5 pruebas de los scripts y las comprobaciones TypeScript de API y frontend.

# Jira OAuth: configuración y prueba controlada

El botón **Conectar con Jira** está en menú de usuario → **Mis integraciones**, y en **Configuración → Integraciones**. Conecta una cuenta y un sitio Jira por usuario de QA Tracker. Los destinos por proyecto y la creación manual de reportes se conservan.

## 1. Registrar la aplicación en Atlassian

Una persona responsable de QA Tracker registra la aplicación en https://developer.atlassian.com/console/myapps/ mediante **Create → OAuth 2.0 integration**. Esta aplicación sirve para los usuarios de QA Tracker; cada usuario no necesita crear su propia aplicación.

En **Permissions**, agrega la API de Jira y estos scopes clásicos:

- `read:jira-work`: consultar proyectos y metadatos para las incidencias.
- `write:jira-work`: crear incidencias y adjuntar evidencias cuando el usuario lo solicita.
- `read:jira-user`: identificar la cuenta que autoriza.

El código incluye además `offline_access` en la solicitud de autorización para obtener acceso renovable.

En **Authorization → OAuth 2.0 (3LO)** configura esta Callback URL para la prueba local:

```text
http://localhost:3000/settings/integrations/jira/callback
```

La dirección corresponde al frontend: la página de regreso envía el código al backend usando la sesión autenticada de QA Tracker. El secreto de la aplicación permanece en el backend.

En **Settings** obtén Client ID y Client secret. No los compartas en el chat ni los agregues a Git. Inicialmente prueba con la persona propietaria de la aplicación. Antes de habilitar otros usuarios, configura **Distribution / sharing** y los requisitos correspondientes de Atlassian. La organización de Jira puede restringir quién autoriza aplicaciones externas.

## 2. Configurar el backend

En `api/.env` local:

```dotenv
JIRA_OAUTH_CLIENT_ID=ID-DE-LA-APLICACION
JIRA_OAUTH_CLIENT_SECRET=SECRETO-DE-LA-APLICACION
JIRA_OAUTH_REDIRECT_URI=http://localhost:3000/settings/integrations/jira/callback
```

Conserva `JIRA_CREDENTIALS_ENCRYPTION_KEY`, ya provisionada en local. Es la clave de 32 bytes codificados en base64 utilizada para cifrar tokens; no es el Client secret. En otro entorno debe provisionarse por separado y conservarse con los respaldos seguros.

Reinicia la API una sola vez. Si el puerto 1337 está ocupado, revisa la API existente antes de iniciar otra. La pantalla indica **OAuth pendiente de configuración** hasta que las tres variables y la clave de cifrado sean válidas.

En producción usa la URL HTTPS real del frontend terminada en `/settings/integrations/jira/callback`, idéntica a la registrada en Atlassian. Despliega API y frontend juntos y usa credenciales de aplicación acordes a ese entorno. No uses variables `VITE_` para el Client secret o las claves de cifrado.

## 3. Primera prueba, sin crear tickets

1. Abre QA Tracker local en `http://localhost:3000` e inicia sesión.
2. En **Mis integraciones**, pulsa **Conectar con Jira**.
3. Revisa y acepta los permisos en la pantalla oficial de Atlassian.
4. Al regresar, selecciona uno de los sitios autorizados y pulsa **Guardar sitio de Jira**.
5. Comprueba que aparezca la cuenta y el sitio esperados.
6. En un proyecto, consulta sus proyectos/tipos de Jira y revisa el destino. Todas estas consultas son de lectura.
7. Prueba **Desconectar**. Los tickets y resultados anteriores se conservan.

Estos pasos no llaman a la creación de incidencias ni a la subida de adjuntos. El código conserva el bloqueo `JIRA_ENABLE_WRITES`; conectar OAuth no cambia ese valor. La primera prueba de creación requiere autorización explícita del usuario y su clic en **Crear en Jira**.

## 4. Renovación y desconexión

El backend renueva el acceso cerca del vencimiento usando el refresh token rotatorio. Guarda el nuevo par cifrado. Un bloqueo en base de datos evita renovar simultáneamente el mismo token; otra petición concurrente recibe un mensaje para reintentar en unos segundos.

Si la renovación falla o queda incierta, se elimina el acceso guardado y aparece **Reconectar**. Un fallo no repite automáticamente una creación de ticket. Un HTTP 401 de Jira también marca la conexión para reconectar. Las políticas de cuenta y los permisos de Jira siguen aplicándose.

**Desconectar** borra las credenciales de QA Tracker y cancela autorizaciones pendientes. Para retirar también el consentimiento en Atlassian, usa la administración de aplicaciones conectadas de tu cuenta Atlassian. Una renovación en curso no puede restaurar una cuenta desconectada.

## 5. Seguridad y compatibilidad

- State aleatorio de 256 bits, almacenado como SHA-256 y vinculado al usuario autenticado; caduca a los diez minutos y se consume una sola vez. Completar o seleccionar siempre requiere JWT válido de QA Tracker y membresía activa.
- El código de autorización se elimina de la URL mediante `history.replaceState` antes del intercambio y se envía por POST. No se guarda en almacenamiento del navegador ni en la caché de mutaciones. El frontend incluye `Referrer-Policy: no-referrer` mediante meta.
- Configura el hosting/proxy del frontend para no registrar los parámetros `code` y `state` de la ruta de regreso. Es un requisito de despliegue: el HTML no controla los registros del proxy que recibe esa URL.
- Client secret, access token y refresh token no llegan al frontend. Los tokens se cifran con AES-256-GCM y asociación al usuario; se reutiliza la clave existente de Jira.
- Se consultan los sitios mediante `accessible-resources`; se filtran sitios Jira HTTPS y permisos necesarios. El servidor elige la URL de la API usando el Cloud ID autorizado, nunca una URL enviada por el navegador.
- Transacciones y revisiones evitan reutilizar selecciones o sobrescribir una desconexión. Cada llamada a Jira verifica también el acceso al proyecto en QA Tracker. Al renovar se comprueba que siga autorizado el sitio.
- Nuevas tablas `jira_oauth_accounts` y `jira_oauth_sessions`, sin alterar columnas de proyectos. No tienen rutas CRUD públicas. Las sesiones vencidas se limpian al iniciar una conexión.
- La cuenta anterior se mantiene mientras la autorización esté pendiente o se cancele. Al elegir un sitio correctamente, OAuth toma prioridad y elimina el token manual guardado. Desconectar nunca reactiva el token del entorno.
- El formulario manual de API token queda solo para desarrollo y no acepta guardados en producción. Una cuenta que ya eligió OAuth continúa usando OAuth. Las variables antiguas del entorno pueden retirarse cuando ya no se necesite la compatibilidad anterior.
- Si cambias de Client ID, debes reconectar las cuentas afectadas. No cambies la clave de cifrado sin migrar las credenciales existentes.

## Fuentes

[OAuth 2.0 (3LO), permisos, sitios y renovación de Atlassian](https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/).

## Estado de verificación

El intercambio con Atlassian y las consultas Jira se verifican con respuestas simuladas. Las pruebas cubren state, caducidad, replay, cuentas distintas, sitio inválido, selección única, cifrado, renovación simultánea, revocación y desconexión durante renovación. La prueba real de consentimiento requiere registrar la aplicación y configurar Client ID/secret; no se pueden inventar esas credenciales.

Verificación realizada: 80 pruebas del backend aprobadas, TypeScript de API y frontend sin errores y recorrido Chromium con autorización/callback/selección/desconexión simulados. El recorrido comprueba que el código se elimine de la URL, que se intercambie una sola vez y que no se creen incidencias. La API local reconoce las rutas nuevas; reporta OAuth pendiente de configuración y conserva la cuenta anterior del entorno.

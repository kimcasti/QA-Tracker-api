# Conexión personal de Jira con token de API

OAuth es ahora el flujo principal: ver [Jira OAuth](jira-oauth.md). El formulario de token manual se mantiene solo en desarrollo; el backend rechaza nuevos guardados manuales en producción. Las cuentas que ya usan OAuth se reemplazan mediante una nueva autorización OAuth.

## Uso

Menú del usuario → **Mis integraciones**. También está disponible en **Configuración → Integraciones** para los administradores de proyectos.

1. Completa URL del sitio (`https://empresa.atlassian.net`), correo Atlassian y token de API.
2. Para un token con ámbitos que requiera el gateway Atlassian, abre las opciones y completa el Cloud ID del mismo sitio.
3. Pulsa **Validar y guardar conexión**. La API consulta `GET /rest/api/3/myself`; para tokens con Cloud ID también consulta `GET /rest/api/3/serverInfo` para comprobar la correspondencia del sitio. Si falla, conserva la conexión anterior.
4. Un administrador configura el proyecto y tipo de incidencia en **Configuración → Integraciones → Destino de Jira para este proyecto** (también disponible en Editar Proyecto).
5. Cada persona crea reportes usando sus propias credenciales y los permisos de su cuenta de Jira. El destino del proyecto es compartido; debe pertenecer al mismo sitio que su cuenta.

Una cuenta Jira por usuario de QA Tracker en esta primera versión. Puede servir para varios proyectos del mismo sitio. Reemplazar el sitio requiere revisar los destinos de los proyectos.

Guardar credenciales no crea tickets ni envía evidencias. El reporte sigue requiriendo vista previa y clic manual. El bloqueo global `JIRA_ENABLE_WRITES` se conserva y no se cambia al guardar credenciales.

**Desconectar** elimina el token cifrado de QA Tracker y bloquea el uso del token anterior del entorno para ese usuario. No elimina tickets ni revoca el token en Atlassian: esa revocación se realiza desde Atlassian. Los destinos de los proyectos se conservan para una futura reconexión.

El estado muestra cuándo se validó por última vez, no una consulta permanente de vigencia. Si Jira rechaza un token vencido/revocado, se muestra el error y la persona debe reemplazarlo. No se renueva automáticamente.

## Configuración del servidor

`JIRA_CREDENTIALS_ENCRYPTION_KEY`: 32 bytes aleatorios codificados en base64. Se configura solamente en el backend, nunca con prefijo `VITE_`. La base local ya tiene una clave configurada. En otro entorno hay que provisionarla en su gestor de secretos. Conservarla junto con el respaldo seguro del entorno: cambiarla sin recifrar las credenciales impide recuperarlas y exige reconectar las cuentas.

La nueva tabla `jira_accounts` contiene una fila por usuario y un token cifrado con AES-256-GCM, nonce aleatorio y asociación autenticada al ID del usuario. Las respuestas solo devuelven estado y metadatos. No existen rutas CRUD públicas del modelo, y los campos sensibles son privados. No se altera la tabla de proyectos.

Los endpoints `GET`, `PUT` y `DELETE /api/jira-account` verifican JWT de usuario, cuenta activa y membresía activa. El ID del propietario siempre proviene de la sesión; no se acepta en el cuerpo. Las credenciales de automatización no sirven para estos endpoints. Se limitan las validaciones a seis por minuto y usuario/proceso.

El formulario no guarda tokens en localStorage, sessionStorage ni en la caché de mutaciones. Limpia el campo después de cada intento. Las credenciales viajan al backend por HTTPS en producción, y de allí a Jira con Basic Auth. Se restringen destinos a sitios HTTPS `*.atlassian.net` y el gateway oficial, sin redirecciones.

Compatibilidad: si el usuario aún no tiene fila guardada y coincide con `JIRA_QA_USER_ID`, se conserva la conexión antigua del entorno. Al guardar desde el formulario tiene prioridad la nueva conexión. Al desconectar no hay retorno silencioso a las credenciales del entorno. No se migran ni se reemplazan automáticamente los tokens reales durante el desarrollo.

## Alcance temporal y despliegue

Esta es la implementación transitoria solicitada para evaluación interna. Atlassian documenta restricciones para aplicaciones cloud que recopilan tokens de sus usuarios y recomienda una aplicación OAuth 3LO distribuible: [documentación oficial](https://developer.atlassian.com/cloud/jira/platform/basic-auth-for-rest-apis/). Resolver ese requisito mediante OAuth antes de ofrecer este método a clientes en producción. No se ha desplegado este cambio.

## Verificación

Pruebas con Jira simulado: cifrado aleatorio, rechazo de texto modificado/otro propietario, aislamiento por usuario, conservación de la conexión anterior ante credenciales inválidas, validación exclusiva mediante GET, correspondencia entre Cloud ID y sitio y eliminación al desconectar. Las pruebas existentes de idempotencia de tickets siguen usando un transporte simulado. No crear tickets reales para verificar este formulario.

Validación realizada: 74 pruebas del backend aprobadas, TypeScript de API y frontend sin errores, endpoint local de estado devuelve 401 sin sesión y 200 con sesión, y recorrido Chromium sobre la pantalla real con guardado/desconexión simulados. El recorrido comprueba que al reemplazar la conexión el token aparece vacío, que no se guarda en el almacenamiento del navegador y que no se llama al endpoint de creación de tickets. La cuenta real del entorno se conservó sin cambios.

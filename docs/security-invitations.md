# Invitaciones: prueba de posesión y registro seguro

## Alcance local

Cambio local en `security/tenant-invitations-hardening` (API y cliente). No requiere nuevas dependencias ni secretos de configuración. No se ejecutaron Strapi, servidores, E2E, SQL, migraciones, conexiones de BD ni correos reales. No hay commit, push o deploy.

## Vulnerabilidad corregida

El registro buscaba una invitación pendiente por el email declarado y, sin una prueba de posesión, creaba una cuenta confirmada, membresía y JWT para esa organización. Ahora el email **nunca selecciona ni reclama** una invitación dentro del servicio de signup/aceptación corregido.

La integración también elimina la aceptación automática por email dentro de `src/utils/tenant.ts`, `getUserMemberships`. Consultar membresías ya no consume invitaciones ni reactiva una membresía inactiva. Regresión real RED→GREEN en `src/utils/tenant-memberships.test.ts`, con logs `membership-bypass-{red,green}.log` en scratch. La creación del workspace propio de usuarios sin historial conserva su comportamiento existente.

## Contrato nuevo

- Una invitación nueva (equipo o superadmin) genera un secreto CSPRNG de 32 bytes, representado como 64 caracteres hexadecimales. Se almacena únicamente su SHA-256 (`tokenHash`), con `tokenExpiresAt` a 48 horas. Ambos atributos son opcionales y `private` en el schema.
- El correo existente entrega `?invitation=<documentId>&mode=signup#invitationToken=<secret>`. El secreto va en el fragmento, no en la query de navegación.
- El endpoint público de metadatos exige `X-Invitation-Token`; ya no permite consultar un email/organización con solo el identificador. Responde mediante allowlist, con `Cache-Control: no-store` y `Referrer-Policy: no-referrer`. CORS admite ese header.
- `POST /api/auth/signup` admite `invitationDocumentId` e `invitationToken`. Si llega cualquiera de estos campos, ambos deben probar una invitación pendiente, no vencida, de ese documento y del mismo email normalizado del registro. No hay fallback a organización propia frente a una prueba inválida.
- Si **no** se envía intención de invitación, el alta normal conserva el comportamiento de crear su organización Starter y su membresía inicial. Incluso si existe una invitación pendiente para ese email, esta queda intacta. La confirmación/JWT automática del alta normal preexistente no equivale a una verificación de correo y no autoriza invitaciones.
- Para cuentas locales existentes, `POST /api/auth/invitations/accept` exige email, contraseña actual, documento y secreto. Verifica la contraseña con el servicio users-permissions; rechaza cuentas bloqueadas, no confirmadas o de otro provider. No crea/reemplaza cuentas ni cambia su contraseña. Tiene el rate limiter existente de users-permissions. La ruta usa `auth: false` porque autentica explícitamente contraseña **más** secreto antes de emitir JWT y debe funcionar sin una membresía previa.
- AuthPage conserva ID y secreto en fragmento al pasar entre invitación, recuperación y regreso a login dentro de la navegación de la misma pestaña; nunca pone el token en query, localStorage ni otro almacenamiento añadido. Respeta el modo forgot-password tras consultar metadatos y App conserva AuthPage con una sesión existente para invitaciones y recuperación. Una invitación incompleta/no validada no puede enviarse como alta normal. Tras aceptación exitosa reemplaza la URL por `/`. La aceptación exige las credenciales de la cuenta invitada. **No hay continuidad automática al abrir el correo de reset en otra pestaña ni al reemplazar la URL por un enlace sin contexto**: la interfaz indica volver a abrir el enlace original de invitación después de restablecer la contraseña; no se añade el bearer de invitación al correo de reset.
- Los listados de equipo y superadmin no exponen secreto, hash ni enlaces de aceptación. Se retiró la acción de fabricar/copiar un enlace a partir del documentId: para recuperar acceso se debe reenviar el correo.

## Uso único, carreras y fallos

La aceptación verifica la prueba y realiza un `db.query(...).updateMany` condicional por documento, email, estado pendiente, hash y expiración. Solo `count === 1` permite continuar. Esta primera actualización **no publica `accepted`**: mantiene `pending` y el hash exacto, pero anula `tokenExpiresAt` antes de abrir la transacción. El hash sin expiración es un marcador de reclamación, no un secreto válido: la verificación y el CAS de consumo exigen una expiración futura. Dos peticiones concurrentes no pueden consumir el mismo secreto. El servicio vuelve a leer el reloj al consumir, después de validar los datos o la contraseña.

El reenvío rota el secreto mediante otra actualización condicional y lo guarda **antes** de enviar. Invalida el enlace anterior y no permite reabrir una invitación ya aceptada. Si el envío falla, elimina únicamente el hash de esa rotación, sin restaurar el enlace anterior ni sobreescribir una rotación/aceptación posterior. No existe una actualización incondicional a pendiente después de enviar que pueda deshacer una aceptación rápida.

### Atomicidad del acceso y secreto quemado

La aceptación de cuenta existente y el signup invitado ejecutan **creación de usuario (cuando aplica), creación/reactivación/cambio de rol de membresías y emisión JWT** en el callback esperado de `strapi.db.transaction`. Se espera también la emisión JWT: una excepción síncrona o rechazo asíncrono aborta el callback. No se compensa borrando memberships: el rollback SQL debe restaurar sus valores previos, incluso una membresía inactiva reactivada o un rol cambiado parcialmente. El signup normal conserva su camino y compensación anteriores; no se afirma atomicidad nueva para crear un workspace sin invitación.

El quemado condicional del secreto es deliberadamente **anterior y exterior** a esa transacción, para que un rollback no restaure una prueba reutilizable. `accepted` autoriza asignaciones de proyecto en `tenant.ts`, por lo que publicarlo antes del acceso abriría una ventana de autorización y otorgaría proyectos incluso si falla abrir la transacción. Ahora, después de esperar la acción de acceso/JWT, el mismo callback transaccional publica `accepted` mediante CAS por documento, email, `pending`, **hash exacto reclamado y expiración nula**, y borra el hash. Si un reenvío ganó antes de ese CAS (incluso si falló su entrega y borró el nuevo hash), el CAS falla y aborta las escrituras de acceso. Si la publicación gana primero, el CAS de reenvío ya no puede cambiar `accepted`. No hay compensación exterior de estado ni restauración de secreto. No se acepta una transacción externa porque su rollback podría restaurar el secreto. Los callbacks deben usar las APIs DB/documentos de esta instancia Strapi y esperar sus operaciones; efectos externos, SQL por otra conexión o trabajos no esperados quedan fuera.

Si falla abrir la transacción o cae el proceso tras el quemado, queda `pending` sin expiración válida: no publica proyectos y requiere reenvío. Un rollback confirmado revierte acceso y publicación conjuntamente, conservando el quemado anterior. Un fallo real de commit/rollback o una respuesta perdida exige revisión administrativa: el resultado SQL puede ser incierto y **no** se promete ausencia de acceso ni reparación automática. No hay restauración de secretos ni borrado masivo de memberships previos.

API comprobada en código oficial **instalado** Strapi 5.39.0: `node_modules/@strapi/database/dist/index.{js,d.ts}` (`transaction(callback)`, `inTransaction`, commit/rollback esperados), `transaction-context.js` (AsyncLocalStorage), `query/query-builder.js:464-470` (queries usan `transacting` del contexto). `@strapi/core/dist/services/document-service/common.js` y `repository.js` envuelven las operaciones de documentos en transacciones anidadas que reutilizan ese contexto; `@strapi/plugin-users-permissions/server/services/user.js:61-65` crea usuarios mediante `strapi.db.query`. No se usan hooks `onRollback` para reparación asíncrona: el código instalado no espera sus promesas.

Evidencia focalizada Node 20.20.2 y precarga sin sockets: `invitation-atomicity-red.log` reproduce dos fallos (JWT posterior al enlace y enlace parcial con membresía previa modificada); `invitation-atomicity-signup-red.log` reproduce cuenta/enlace parcial persistentes. `invitation-atomicity-final.log` contiene la regresión y tokens; `invitation-atomicity-tsc.log`, el typecheck. Las pruebas ejecutan **la implementación real instalada de `Database.prototype.transaction` y su contexto**, sustituyendo solo conexión/almacenamiento por un adaptador controlado que modela commit/rollback; los callbacks de acceso se simulan y se comprueba el contexto después de un await. No son integración SQL: quedan pendientes rollback de tablas/relaciones reales, aislamiento, locks, concurrencia MySQL y fallos reales de commit/rollback bajo un motor transaccional autorizado.

## Compatibilidad e impacto de despliegue futuro

- Las invitaciones antiguas sin hash/expiración permanecen pendientes y no se reclaman por email ni por el enlace antiguo. Un administrador debe reenviarlas para generar una prueba nueva.
- Usuarios, contraseñas y memberships ya existentes no se migran ni eliminan.
- El schema agrega dos columnas opcionales (`tokenHash`, `tokenExpiresAt`) del endurecimiento inicial; esta corrección no agrega columnas, nonce ni valores al enum. Reutiliza el hash privado exacto más expiración nula como marcador quemado, y mantiene `pending` hasta el commit de acceso. La sincronización/migración de schema en el siguiente arranque debe revisarse y autorizarse por separado; **no se inició ni modificó la BD en esta tarea**.
- Desplegar API y cliente de forma coordinada. El cliente antiguo no adjunta prueba y los enlaces antiguos dejan de aceptar invitaciones; esto es intencional, no debe agregarse un fallback por email.
- SMTP/Mailtrap debe entregar correo y `INVITATION_APP_URL` debe apuntar al cliente correcto. No se puede recuperar un secreto desde la BD ni desde listados. Si falla la entrega, corregir configuración y reenviar. Compartir un enlace bearer recibido por correo concede la prueba a quien lo reciba; tratarlo como secreto y usar HTTPS.
- La prueba no sustituye las autorizaciones de tenant/proyecto, la vigencia de la organización ni las políticas de administración existentes.

## Verificación sin infraestructura

Ejecutado con Node **20.20.2**, el major usado por Docker/CI, mediante su ejecutable explícito (sin cambiar PATH). Todos los tests llevan la precarga local `qa-audit-no-network.cjs`, que bloquea conexiones de sockets. No se cargó `.env`.

Tests API relevantes:

- `src/utils/invitation-tokens.test.ts`: entropía/formato, hash, expiración, rechazo de pruebas ausentes/incorrectas/vencidas/consumidas/legacy/email distinto, consumo concurrente y replay, rotación y fallo de entrega.
- `src/utils/invitation-mail.test.ts`: URL del correo real con secreto en fragmento y privacidad/compatibilidad de schema.
- `src/api/auth/services/auth.test.ts`: servicio real de signup/aceptación, cuenta normal con email invitado, ausencia de efectos antes de probar el token, vencimiento durante validación, contraseña real bcrypt en cuenta existente y compensación de fallo.
- `src/api/auth/services/invitation-config.test.ts`: CORS y rate limiter de la nueva ruta.
- `src/api/organization-team/controllers/organization-team.test.ts` y `invitation-public.test.ts`: creación/hash/entrega y metadatos públicos protegidos.
- `src/api/superadmin/controllers/invitation-proof.test.ts`: controladores reales de creación/reenvío y constructor de correo real; solo BD y transporte SMTP sustituidos, sin envío.

Tests cliente: `tests/security/auth-invitations.test.ts`, ejecutado con `QA_SECURITY_SCRATCH` apuntando al scratch local (opcional; usa `os.tmpdir()` y limpieza `mkdtemp` si no se define). Empaqueta el servicio real con esbuild y `import.meta.env={}` (sin leer configuración real), sustituye únicamente el adaptador HTTP, y comprueba payloads de signup/login, header de metadatos y helpers de AuthPage. Incluye dos guardas estructurales de UI (no reconstruir enlaces, atender enlaces con sesión). No sustituye pruebas de navegador.

Comandos base desde cada repo, usando el ejecutable Node 20 explícito:

```bash
# API: pasar las siete rutas de test enumeradas arriba a este comando
node --import tsx --test <rutas-de-tests>
node node_modules/typescript/bin/tsc --noEmit --pretty false

# Cliente: definir QA_SECURITY_SCRATCH en un directorio scratch local
node --import tsx --test tests/security/auth-invitations.test.ts
node node_modules/typescript/bin/tsc --noEmit --pretty false
```

Evidencia local: `invitations-01-red.log` / `invitations-01-green.log` y siguientes ciclos numerados; resultados finales en `invitations-api-final.log`, `invitations-client-final.log`, `invitations-api-tsc.log`, `invitations-client-tsc.log`, bajo el scratch de Hermes. RED reproduce el fallo antes del arreglo de cada slice; GREEN verifica el mismo slice después.

## Evidencia de corrección de publicación y recuperación

Logs de esta revisión bajo `C:/Users/Kimberly Conde/AppData/Local/hermes/cache/scratch/security-hardening-review/`:

- `invitation-publication-token-red.log` (1 fallo esperado) → `invitation-publication-token-green.log` (4/4): consumo único sin publicar permisos, con hash marcador y expiración nula.
- `invitation-publication-auth-red.log` (2 fallos esperados) → `invitation-publication-auth-green.log` (4/4): publicación junto al commit, permisos previos durante la ventana, fallo de apertura, rollback de callback/commit y CAS contra reenvío concurrente entregado o fallido.
- `invitation-publication-api-final.log`: **26/26**, incluyendo tokens, auth, publicación, mail/schema y configuración. `invitation-publication-api-tsc.log`: salida vacía, exit 0.
- `invitation-recovery-client-red.log` y `invitation-recovery-client-app-red.log`: fallos antes de incorporar helper/UX y guardas de sesión. `invitation-recovery-client-green.log`: **8/8**. `invitation-recovery-client-portable.log`: **8/8** sin `QA_SECURITY_SCRATCH`, con TEMP/TMP dirigidos al scratch autorizado. `invitation-recovery-client-tsc.log`: salida vacía, exit 0.

Todos ejecutados con el Node 20.20.2 explícito y `NODE_OPTIONS='--require "C:/Users/Kimberly Conde/AppData/Local/hermes/cache/scratch/qa-audit-no-network.cjs"'`. `invitation-publication.test.ts` usa el servicio de autenticación y `getUserProjectAccessScope` reales, el `Database.prototype.transaction` instalado y un adaptador de almacenamiento controlado con estados committed/working separados; solo sustituye BD, escrituras de membresía y JWT. El lector de autorización observa committed, como otra solicitud. Es evidencia unitaria, no prueba del aislamiento SQL real. Los tests cliente ejecutan el helper de navegación y servicio reales y comprueban su conexión a componentes mediante guardas estructurales; no se afirma haber renderizado/navegado AuthPage en un navegador.

## Límites pendientes

No se probó un motor SQL real, sincronización del schema, permisos/rutas en Strapi iniciado, transporte de correo, proxy/CORS real o navegación de navegador. La atomicidad SQL está expresada por un compare-and-set de una fila y se prueba con adaptadores de BD controlados, no con concurrencia de MySQL real. Esas verificaciones requieren otra autorización y un entorno aislado; no ejecutar contra datos de producción.

# Reportes de Jira: Forbidden

Si la cuenta aparece conectada en **Mis integraciones**, pero la evidencia muestra
solo `Forbidden` antes de abrir la vista previa, revisar la autenticación de
`GET /api/jira-integration/:projectKey`. El estado se consulta en QA Tracker sin
consultar Jira: este error no demuestra que falten permisos en Atlassian.

Las rutas del conector usan `global::user-session` para validar el JWT del usuario
y `global::has-active-membership` para exigir una membresía activa, igual que las
integraciones personales. No dependen de los permisos del rol global de Strapi.
El controlador sigue exigiendo pertenencia a la organización del proyecto,
rol owner/qa-lead para configurar y owner/qa-lead/qa-engineer para reportar.
Las credenciales se resuelven exclusivamente para el usuario de la sesión.

Tras actualizar el código, reiniciar la API (compilar primero si se ejecuta
desde `dist`) y pulsar **Reintentar** en la evidencia. No es necesario reconectar
la cuenta para aplicar esta corrección de autenticación.

Si aparece un mensaje que indica que **la cuenta no tiene permisos para esta
operación en Jira**, la petición sí llegó a Atlassian: comprobar los permisos
del usuario en el proyecto de destino. El envío también requiere
`JIRA_ENABLE_WRITES=true`, un destino configurado en el mismo sitio de la cuenta
y un resultado de ejecución guardado. La creación requiere revisar la vista
previa y pulsar **Crear en Jira**.

La prueba de regresión `src/api/jira-integration/routes/jira-integration.test.ts`
comprueba el acceso con un rol global personalizado y el rechazo de sesiones
inválidas, cuentas bloqueadas/no confirmadas, otros tenants y roles sin permiso.
No realiza peticiones a Jira.

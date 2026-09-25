# Protocolo de ejecutor local, versión 1

La implementación está en `src/api/automation-runner`. Requiere publicar API, frontend y scripts del proyecto automatizado de forma coordinada. No se ha desplegado automáticamente.

## Persistencia y autorización

Strapi sincroniza dos nuevas tablas aditivas al arrancar la versión actualizada:
`automation_runners` y `automation_jobs`. No hay migración destructiva de resultados existentes.
Los tipos son internos, sin rutas CRUD públicas.

El ejecutor usa el bearer `qat_...` de la conexión existente. La política
`automation-token` comprueba caducidad, revocación, usuario activo y permisos actuales del proyecto.
La sesión efímera enviada por el proceso se guarda como hash y evita dos procesos simultáneos en la misma carpeta.
Los endpoints de interfaz usan `automation-session` más validación de rol de ingeniería, organización y acceso al proyecto de la ejecución.

## Endpoints

Todos los cuerpos POST usan `{ "data": { ... } }`; las respuestas usan `{ "data": ... }`.

| Método/ruta | Autorización | Datos |
| --- | --- | --- |
| POST /api/automation-runner/register | Conexión | session, catalog: referencias exactas |
| POST /api/automation-runner/poll | Conexión | session, claim: boolean, jobId opcional, completedCount opcional |
| POST /api/automation-runner/interrupt | Conexión | session, jobId |
| POST /api/automation-runner/complete | Conexión | session, jobId, results |
| GET /api/automation-runs/:runId/runner | Sesión web | Disponibilidad, casos, problemas de catálogo e historial sin imágenes |
| POST /api/automation-runs/:runId/jobs | Sesión web | runnerId, caseIds, requestId único del intento |
| GET /api/automation-runs/:runId/jobs/:jobId | Sesión web | Detalle y evidencias, cargados bajo demanda |

Cada resultado contiene `automationReference`, `status` (passed/failed/skipped/unknown),
`notes` opcionales y `evidenceImage` opcional (PNG/JPEG/WebP como data URL).
Se rechazan resultados faltantes, ajenos, duplicados y capturas no válidas.
Las referencias se comparan exactamente, sin convertirlas a minúsculas.

## Atomicidad y recuperación

- La transacción bloquea la fila de conexión y, al crear/publicar, la ejecución.
- Índices únicos en activeRunner y activeRun impiden trabajos activos duplicados.
- requestKey hace idempotente un doble clic/reenvío de la solicitud de creación.
- El cambio pending -> running es condicional. Un latido sin claim nunca reserva trabajo.
- Estados del trabajo: pending, running, completed, interrupted. Son independientes del resultado de cada test.
- Un temporizador del backend revisa los trabajos cada 15 segundos; 90 segundos sin latido interrumpen el trabajo, sin reencolarlo.
- La publicación actualiza únicamente las filas seleccionadas que aún pertenecen a esa ejecución. Conserva orden, relaciones de bugs y resultados ajenos.
- Resultados y recibo se guardan en la misma transacción. Un reenvío idéntico no vuelve a escribir.
- Se acepta un reporte final retrasado de un trabajo interrumpido solo si la ejecución continúa en borrador y no tiene un trabajo posterior.
- El ejecutor conserva un diario por trabajo y una bandeja de reportes pendientes. Un trabajo sin reporte final nunca se vuelve a ejecutar por recuperación.

Mantener el campo `automationReference` único entre los casos Playwright automatizados del proyecto.
Al crear una ejecución, sus casos deben estar guardados como filas de resultados.

## Verificación

```bash
node node_modules/typescript/bin/tsc --noEmit --incremental false
npm test
```

Las pruebas de servicio usan un adaptador en memoria con transacciones serializadas y rollback.
Comprueban permisos, doble clic, reserva, desconexión, resultados ajenos y publicación idempotente.
No sustituyen una prueba de despliegue sobre la base MySQL del ambiente de prueba.
Los tests del ejecutor usan una API HTTP local simulada y Playwright real, sin registros de negocio.
En el repositorio frontend, `node --test scripts/automation-runner-ui.test.mjs` valida el diálogo en Chromium con respuestas simuladas, incluida la selección entre módulos, referencias inválidas, desconexión y evidencias.

Antes de desplegar, aplicar el procedimiento habitual de respaldo y probar el flujo en QA Tracker de prueba:
abrir una ejecución con dos módulos, conservar una fila manual, ejecutar dos referencias, comprobar sus resultados y reenviar el mismo reporte.

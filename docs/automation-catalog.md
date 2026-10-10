# Comparar y asignar referencias automatizadas

En **Estrategia QA → Tabla de cobertura → Comparar referencias**, seleccionar una conexión y Local/Test, obtener el catálogo y revisar las referencias sin asignar. Las sugerencias por título nunca se seleccionan automáticamente. Elegir los casos, pulsar **Revisar vínculos** y guardar el lote. El catálogo corresponde a la carpeta y ambiente seleccionados, no al historial de resultados.

## Actualizar una carpeta conectada

Desde el repositorio de la API:

```powershell
node scripts/update-automation-runner.mjs "C:/ruta/al/proyecto/qa-automation"
```

Desde el workspace que contiene `api` y `client`, sigue disponible el mismo comando mediante `scripts/update-automation-runner.mjs`. El actualizador preserva conexión, recuperación de resultados, configuración y scripts de evidencia; guarda un respaldo `.before-catalog.bak`. Si no reconoce la versión, falla sin modificar el ejecutor.

Detener y reiniciar `npm run qa:runner` después de actualizar. Las versiones actualizadas anuncian `catalogRefreshVersion: 1`. No iniciar un segundo proceso para la misma conexión. Los ejecutores antiguos conservan el flujo de pruebas existente, pero la detección nueva muestra instrucciones de actualización.

## Contrato de API

Los endpoints web utilizan JWT de usuario, permisos de ingeniería y validación del proyecto/organización. Todos los cuerpos POST y respuestas emplean `{ data: ... }`.

| Método y ruta | Uso |
| --- | --- |
| GET `/api/automation-projects/:projectKey/catalog-connections` | Conexiones vigentes, ejecutor, disponibilidad, compatibilidad y ambientes |
| POST `/api/automation-projects/:projectKey/catalog-requests` | Solicitar detección con `runnerId`, `environment`, `requestId` |
| GET `/api/automation-projects/:projectKey/catalog-requests/:requestId` | Estado, catálogo y casos actuales de todo el proyecto |
| POST `/api/automation-projects/:projectKey/catalog-requests/:requestId/assignments` | Guardar `requestId` del intento, `catalogHash` y `assignments: [{caseId, reference, snapshot}]` |
| POST `/api/automation-runner/completeCatalog` | Publicar `session`, `catalogRequestId` y `references` o `error` con el token de la conexión |

`poll` devuelve `catalogRequest: { id, environment }` solo a la reserva del bucle inactivo (`claim: true`). Los latidos no reservan detecciones. El ejecutor obtiene referencias con Playwright `--list`, manteniendo su reporter/configuración y los latidos. La detección tiene un límite de 120 segundos; la solicitud vence a los 150 segundos. Las ejecuciones y detecciones se excluyen mediante el bloqueo de conexión. Los catálogos vacíos se admiten y los duplicados se conservan para revisión.

La comparación es exacta, incluyendo mayúsculas. Se consideran ocupadas las referencias de todos los casos, incluso manuales u obsoletos. Un lote admite hasta 200 vínculos únicos y valida nuevamente referencias y snapshots. Todos los writes de casos mediante document service comparten un bloqueo por proyecto; la transacción del lote incluye su recibo de auditoría y permite reintentos idempotentes. Los reemplazos limpian únicamente el último resultado/fecha automatizados y conservan el historial, contenido, relaciones, orden y responsable.

## Validación

Desde `api`:

```powershell
npm test
node node_modules/typescript/bin/tsc --noEmit --incremental false
npm run build
node scripts/validate-catalog-mysql.cjs
```

La integración MySQL exige un host local y crea/elimina una base temporal `qa_catalog_test_<identificador>`, sin escribir en la base configurada de la aplicación. Verifica el esquema, bloqueos, asignación, reintentos, rollback y ediciones concurrentes.

Desde `client`:

```powershell
node --import tsx --test scripts/catalog-comparison.test.ts
node --test scripts/catalog-comparison-ui.test.mjs scripts/catalog-runner.test.mjs
npm run lint
npm run build
```

El test del ejecutor utiliza un test Playwright real cuyo cuerpo crea un archivo; comprueba que listar referencias nunca lo ejecuta. El test de navegador valida sugerencias sin selección automática, revisión de reemplazos, guardado de la selección y tamaño móvil.

## Publicación coordinada

1. Respaldar la base del destino y publicar primero la API. Strapi añade `automation_catalog_requests` y `automation_runners.catalog_refresh_version`; no hay migración destructiva de resultados.
2. Actualizar/reiniciar una carpeta de pruebas conectada al ambiente de prueba y verificar detección, asignación y ejecución existente.
3. Publicar el frontend contra esa API y comprobar el flujo con una cuenta de ingeniería y otra de consulta.
4. Repetir la publicación API → frontend en producción y distribuir el actualizador. No ejecutar el script de integración MySQL contra un host de producción.

Si hace falta revertir, restaurar las versiones previas de frontend/API y dejar las columnas/tablas aditivas. Los casos ya asignados permanecen compatibles con la versión anterior. Para revertir el ejecutor, restaurar su respaldo y reiniciarlo.

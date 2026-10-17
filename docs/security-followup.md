# Revisión complementaria de seguridad (local)

Trabajo sobre `security/tenant-invitations-hardening` en los repositorios separados API y cliente. Sin despliegue, push, cambios en main, servidores, SQL, correos reales ni migraciones.

## Operaciones y recuperación

Esta rama no configura backups ni certifica recuperación. Antes de cualquier despliegue deben verificarse respaldos restaurables, evidencias externas, claves y versión de ambos servicios. El código local no sanea automáticamente datos, relaciones UAT o cuentas históricas.

## Participantes y alcance por proyecto

El modelo `external-participant` utiliza `sourceProject`, no `project`. La política y los helpers de origen/destino deben usar ese nombre para consultar y autorizar. Para Viewer/Manager, los contactos de proyectos asignados y los contactos organizacionales sin proyecto son visibles dentro de su organización; contactos de proyectos no asignados o de otras organizaciones no lo son. Un contacto organizacional no es público: sigue exigiendo membresía, rol permitido y tenant válido.

La excepción de proyecto nulo es exclusiva de participantes. No permite leer notas, ejecuciones u otros recursos sin asignación. Los filtros del usuario se intersectan con el alcance de la política. Este contrato debe ensayarse también contra el motor SQL/Strapi reales antes del despliegue.

Pruebas nuevas: `src/policies/tenant-external-participants.test.ts`. Evidencia local RED/GREEN en scratch `security-hardening-review/participant-*.log`.

## Bloqueo de UAT

`completionLocked` se comprueba en el servidor tanto al guardar un resultado como al completar una sesión. Una sesión histórica inconsistente (`active` y bloqueada) no admite escrituras aunque se invoque directamente la API. Las sesiones activas desbloqueadas conservan la edición normal. Esto no sustituye control transaccional de carreras entre finalizar y guardar, ni una prueba de integración con base de datos.

Prueba nueva: `src/api/public-uat-session/controllers/public-uat-lock.test.ts`. Evidencia RED de guardado/cierre y GREEN en scratch.

## Guardados masivos y rutas complementarias

La policy deriva organización/proyecto desde el padre persistido (`testRun`/`testCycle`) cuando se omiten en una colección POST. No depende del primer membership y no permite sustituir el proyecto del padre por otro proyecto autorizado. Los tests importan las configuraciones de los routers reales.

El batch y las operaciones individuales `create/update/persist` validan las referencias contra organización/proyecto del padre persistido antes del dedupe o de cualquier escritura. La comprobación incluye relaciones retenidas, fuentes de duplicados y la coherencia del resultado de la fusión. También se preautorizan ejecuciones duplicadas y omitidas frente al tester asignado; no se deben retirar estos controles para arreglar fixtures.

El batch conserva el mapa de cada documentId original a su ganador deduplicado para que un payload parcial dirigido al duplicado eliminado no cree una fila vacía ni borre el ganador con sus evidencias. Antes de efectos se valida también la combinación del payload con el ganador proyectado, no solo cada componente por separado; este control se aplica a create/update/persist y batch.

Se rechazan batches ambiguos con `400 ValidationError` antes de efectos: varios elementos para un ganador, reutilización de identidad de búsqueda que resolvería al mismo destino o convergencia de identidades finales. La validación individual de cada item contra una proyección inicial no basta cuando sus cambios acabarían acumulándose en una misma fila. El contrato admite un único elemento por destino inequívoco.

Validar un valor heredado no lo convierte en un valor explícitamente enviado: los campos omitidos se conservan desde la fila canónica posterior al dedupe. Un `null` explícito sigue limpiando la relación. `create` utiliza el ganador fresco y conserva resultados/evidencias fusionados. Si existen referencias históricas inválidas en las filas afectadas, se rechaza la operación antes de modificar; esta rama no sanea esos datos automáticamente.

El listado de comentarios intersecta los filtros del caller/policy con el proyecto obligatorio. Story Map utiliza el parser de relaciones compartido para guardar el mismo ID que autorizó la policy, incluido `set`. Existen pruebas router→policy→handler para sus recorridos representados.

## Pruebas reproducibles

Se corrigió el comando de unitarios: Node 20 no expande el glob recursivo entre comillas que tenía `npm test`. El runner enumera las rutas `.test.ts` de forma explícita y ordenada y devuelve el código de salida del proceso de pruebas.

- API: `npm test`.
- Cliente: `npm run test:unit`.
- Para el harness del cliente se puede indicar `QA_SECURITY_SCRATCH` con un directorio local autorizado.
- Los unitarios llevan una precarga que bloquea conexiones TCP de Node mediante `net.Socket.connect`; no es un sandbox de red completo y no bloquea explícitamente UDP ni programas nativos lanzados como subprocesos. No cargan dotenv ni deben arrancar Strapi o Vite.
- El runner no incluye `.spec.ts` E2E ni los scripts de UI/integración `.test.mjs` que arrancan servidores. Estas suites requieren una ejecución separada sobre destinos autorizados.
- Los workflows de esta revisión viven dentro de **cada repositorio real**, en `.github/workflows/security-checks.yml`, y ejecutan unitarios y tipos con Node 20. El workflow del directorio padre no queda automáticamente versionado en esos repositorios.

Los workflows son archivos locales: no se afirma que GitHub Actions los haya ejecutado. No hay gate de despliegue verificado ni garantías de SLA por pasar unitarios.

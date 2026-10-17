# Bootstrap seguro y participantes UAT

## Alcance e impacto

Cambios locales exclusivamente; sin commits, push, deploy, migraciones, SQL ni acceso a una base de datos real. Se inspeccionaron `src/index.ts`, los consumidores de `utils/bootstrap` (auth y tenant) y los modelos de test run y external participant antes de modificar el flujo.

### Bootstrap de usuarios

- Se eliminan las credenciales fallback de `bootstrapInitialUser` en **todos** los entornos. No se crea automáticamente una cuenta demo tampoco en desarrollo.
- Cada conjunto de variables es opcional e independiente: `INITIAL_USER_EMAIL`, `INITIAL_USER_USERNAME`, `INITIAL_USER_PASSWORD`; o `SUPERADMIN_EMAIL`, `SUPERADMIN_USERNAME`, `SUPERADMIN_PASSWORD`.
- La ausencia de **todas** las variables de un conjunto desactiva ese seed. No requiere rol autenticado ni consulta usuarios. No se añade una bandera nueva: un conjunto completo y válido constituye el opt-in explícito compatible con la configuración anterior.
- La presencia de cualquier variable del conjunto, incluso vacía, indica intención de seed y exige el conjunto completo. `INITIAL_USER_IS_SUPERADMIN` también cuenta como intención; si se define debe ser exactamente `true` o `false` tras quitar espacios. Su valor por defecto sigue siendo `false` y solo afecta a cuentas nuevas.
- Email con formato válido, username no vacío, password con al menos 16 caracteres tras quitar espacios exteriores y máximo 72 bytes UTF-8. El password real se conserva sin recortarlo; el límite en bytes evita truncamiento bcrypt. Estas comprobaciones no prueban entropía: el operador debe usar una contraseña aleatoria única de un gestor de secretos. Los errores solo describen la configuración, sin incluir valores.
- `index.ts` valida ambos conjuntos antes de las escrituras de bootstrap. Con configuración parcial o insegura, el startup falla cerrado antes de las escrituras de estas rutinas; esto no equivale a garantizar que Strapi no haya hecho trabajo interno previo al hook.
- Sin seed inicial, no se crea organización demo, roles de esa organización ni membresía inicial. Las variables `INITIAL_ORGANIZATION_*` por sí solas no activan seed de usuarios.
- Si el email ya existe, las funciones de seed devuelven la cuenta existente sin actualizar password, provider, bloqueo, confirmación o privilegios. No se promociona ni degrada una cuenta existente desde el seed.
- El seed inicial explícito conserva su comportamiento previo de vincular/reactivar la membresía administrativa de esa cuenta en la organización inicial. Para **no** ejecutar esa operación en una instalación existente, se deben retirar todas las variables `INITIAL_USER_*` del runtime.
- `linkMembershipForRole` verifica que el ID sea entero positivo seguro y que el usuario exista antes de crear o actualizar membresías. Esto también protege sus consumidores de auth/tenant sin cambiar su contrato de retorno.
- No se alteran las otras rutinas existentes: desactivar registro público, permisos, backfill de provider local y temporizador del runner siguen ejecutándose. En particular, el backfill legado puede completar providers vacíos: la garantía de no modificar cuentas corresponde a las funciones de seed, no a una eliminación de ese backfill.

### Activación UAT

Antes de crear/actualizar la sesión, `activate` resuelve la referencia de participante con un único lookup acotado por:

1. `documentId` solicitado;
2. organización del test run autorizado;
3. `sourceProject` igual al proyecto del test run **o sin sourceProject**.

El modelo exige organización y permite `sourceProject` opcional. Se mantienen contactos de organización sin proyecto; un contacto vinculado a otro proyecto se rechaza aunque sea del mismo tenant. La comprobación de ausencia de proyecto usa `sourceProject.id.$null` compatible con los tipos generados. El lookup solo selecciona `documentId`, no nombres/emails ajenos.

Una referencia inexistente, de otro tenant o de otro proyecto recibe el mismo `ValidationError` genérico, sin datos de identidad y sin escrituras de sesión, tanto al crear como al reactivar. `null` u omisión continúan permitidos y escriben una relación nula. No se cambia la interpretación previa de los otros formatos de relación, el esquema ni el contrato de la respuesta válida.

No se modifican generación/verificación de tokens, HMAC, hash persistido, revocación, expiración ni permisos de edición. Las pruebas de regresión ejercitan token/hash válidos, manipulación de token, expiración y revocación mediante el controller real.

### Rutas genéricas UAT

El router core de sesiones queda limitado a `find` y `findOne`; se retiran create/update/delete genéricos y sus nuevas concesiones de bootstrap. Así no se pueden cambiar `testRun`, participante o estado saltándose las validaciones de las acciones específicas. Se mantienen activar, consultar estado, revocar y las acciones públicas firmadas de guardar resultado/finalizar. El cliente examinado consume esas acciones, no el CRUD genérico retirado; integraciones externas que lo utilicen deben migrar al flujo específico. Esto no modifica permisos históricos almacenados ni sanea relaciones ya existentes, pero las rutas de escritura core no se registran.

Regresión `src/api/public-uat-session/routes/public-uat-session.test.ts`: genera el router real de la versión instalada y comprueba que solo registra GET, que no se conceden acciones de escritura core y que las acciones públicas legítimas permanecen. Evidencia RED→GREEN en `uat-core-write-{red,green}.log`.

## Preflight de producción (pendiente de ejecución autorizada)

1. Revisar únicamente la **presencia** de variables de seed en la configuración del despliegue; no imprimir valores ni copiar secretos a logs. Para una instalación existente sin seed, retirar los conjuntos completos, incluida una bandera suelta o valores vacíos. No borrar cuentas.
2. Si se pretende seed explícito, configurar el conjunto completo mediante gestor de secretos: email y username deliberados, contraseña aleatoria única de al menos 16 caracteres y no más de 72 bytes UTF-8. Revisar el email existente y los privilegios esperados: el seed no rota ni promociona cuentas preexistentes. Coordinar por separado cualquier recuperación o cambio real de privilegios.
3. Revisar también `SUPERADMIN_*`: configuración parcial antes ignorada ahora impide startup. Configuraciones completas con passwords cortos también se rechazan, incluso si la cuenta ya existe. Para preservar un startup sin seed, retirar esas variables en lugar de cambiar usuarios reales.
4. Revisar `INITIAL_ORGANIZATION_*` si habrá seed inicial: ese flujo conserva la vinculación/reactivación de membresía administrativa. Sin seed no se recrea la organización demo al iniciar.
5. Antes de habilitar tráfico, verificar en un entorno autorizado las consultas relacionales reales de Strapi, especialmente el contacto sin `sourceProject`, y los flujos positivos/negativos del cliente. Aquí solo se usaron repositorios en memoria, no integración de base de datos ni E2E.
6. Auditar de manera autorizada las sesiones UAT históricas con relaciones de participante fuera de organización/proyecto. Este parche bloquea nuevas activaciones incorrectas, pero **no sanea, revoca ni modifica sesiones preexistentes**, ni añade validación retroactiva a sus lecturas. Acordar una remediación independiente antes de exponer sesiones históricas sospechosas.
7. Mantener los secretos actuales de UAT y la configuración de URLs. Este parche no rota secretos ni corrige el fallback de secreto UAT existente; verificar que producción tenga secreto explícito seguro sin revelarlo. No alterar tokens válidos por este cambio.
8. Tener rollback de código/configuración revisado; no reintroducir el seed con defaults como método de recuperación.

## Evidencia local y límites

Runtime explícito: `C:/Users/Kimberly Conde/AppData/Roaming/nvm/v20.20.2/node.exe` (Node 20.20.2), sin `nvm use` ni cambios globales. Todos los tests se ejecutaron con `--require C:/Users/Kimberly Conde/AppData/Local/hermes/cache/scratch/qa-audit-no-network.cjs --import tsx --test`; el preload bloquea conexiones de socket reales. No se inició Strapi ni DB.

Archivos de prueba:

- `src/utils/bootstrap.test.ts`: seed ausente, parcial, inseguro, completo; conservación de cuenta; opt-in de privilegio; usuario inexistente/ID inválido y vínculo positivo.
- `src/utils/bootstrap-startup.test.ts`: hook real sin seed y fallo de configuración antes de escrituras.
- `src/api/public-uat-session/controllers/public-uat-session.test.ts`: controller real y factory de Strapi, sin helper alternativo; tenant/proyecto ajenos en creación/reactivación, contacto válido del proyecto o de organización, participante opcional/inexistente y regresiones criptográficas.

Resultado focal final: **35 tests, 35 pass, 0 fail**, log `bootstrap-uat-final-green.log` en el scratch indicado. Una ejecución intermedia de `tsc --noEmit --incremental false` pasó tras corregir el filtro nulo tipado. La última repetición quedó bloqueada únicamente por errores TS2345 concurrentes de `TenantPolicyContext` en `src/api/bug/controllers/bug.ts:266` y `src/api/meeting-note/controllers/meeting-note.ts:84`; no presenta errores en los archivos de este cambio. Log actual `bootstrap-uat-tsc-final.log`. No se declara un typecheck global final en verde.

TDD secuencial registrado en scratch:

| Slice | RED observado | GREEN |
| --- | --- | --- |
| Bootstrap 01 | Creación fallback donde se esperaba null | Seed ausente desactivado |
| Bootstrap 02 | Cuatro rechazos esperados ausentes (parcial/password inseguro de ambos seeds) | Validación cerrada |
| Bootstrap 03 | Dos updates de cuentas existentes y falta de rechazo de usuario inexistente | Cuentas conservadas y guard de usuario |
| Bootstrap 04 | Startup intentaba seed documental sin opt-in; configuración parcial no se validaba antes | Hook sin seed compatible y preflight de ambos conjuntos |
| UAT 01 | Dos referencias de tenant ajeno aceptadas | Lookup acotado por organización |
| UAT 02 | Dos referencias de proyecto ajeno aceptadas | Scope de proyecto/contactos globales |
| UAT 03 | Contrato y contacto sin proyecto fallaban al exigir filtro relacional tipado | `sourceProject.id.$null` y casos válidos |
| Bootstrap 05 | Dos passwords multibyte sobre límite bcrypt aceptados | Máximo 72 bytes UTF-8 |

Logs RED/GREEN por slice: `bootstrap-01-{red,green}.log` hasta `bootstrap-04-{red,green}.log`, `uat-01-{red,green}.log`, `uat-02-{red,green}.log`, `uat-03-red.log`, `bootstrap-05-red.log`; el GREEN final de los últimos slices está en `bootstrap-uat-final-green.log`. El primer RED contiene únicamente la credencial fallback de prueba ya presente en el código anterior, no un secreto real.

La ejecución ampliada local capturó 27 archivos / 169 tests: 168 pass, 1 fail en `project-proposal update independently authorizes persisted origin` (`src/policies/tenant-controller-isolation.test.ts`), trabajo concurrente fuera del alcance de estos archivos. No se modificó esa área. Log `bootstrap-uat-all-local-tests.log`. Esta ejecución fue previa a ampliar la cobertura focal final y no debe presentarse como un pase global.

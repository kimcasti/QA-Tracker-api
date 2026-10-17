# Aislamiento y autorización por tenant

## Contrato de seguridad

- La policy `global::tenant-access` usa la organización **persistida** del recurso cuando existe `params.documentId` o `params.id` (nombre utilizado por los routers core de Strapi). Autoriza su tenant, su rol en ese tenant y el proyecto de origen **antes** de resolver relaciones del payload. Un destino propio no permite apropiarse de un recurso ajeno.
- `allowedRoles` se evalúa por organización, no sobre la unión global de roles: ser Owner en A y Viewer en B no concede escritura en B.
- Un recurso inexistente o sin organización persistida falla cerrado con `NotFoundError`. Las organizaciones ajenas y los roles/proyectos insuficientes producen `ForbiddenError`.
- La organización de un recurso existente no se puede reasignar mediante CRUD ordinario, ni siquiera siendo Owner en ambas organizaciones. No se incorpora una opción de traslado entre tenants.
- El proyecto puede cambiar dentro de la misma organización sólo si se autoriza tanto el proyecto de origen como el de destino. Cambiar a un proyecto asignado no permite sacar un recurso de un proyecto no asignado.
- La resolución del payload verifica siempre el proyecto persistido, aunque se proporcione también `organization`. Un proyecto inexistente/sin organización o la combinación proyecto/organización inconsistente producen `ValidationError`.

## Listados y compatibilidad

- Los GET de colección siempre reciben alcance de tenant, incluso si el cliente envía un cuerpo.
- Los tenants se filtran por el rol requerido para esa ruta. En contenido con proyecto se aplica la unión de: organizaciones sin restricción de proyectos; y proyectos asignados dentro de las organizaciones restringidas. Tener Viewer/Manager en B no restringe los proyectos de A donde el usuario es Owner.
- Los filtros del cliente se **intersectan** con los de autorización. Se conservan filtros lógicos, ordenación, paginación y el resto de la consulta; no se reemplaza un filtro de organización por otro más amplio.
- Las creaciones con proyecto válido siguen derivando su organización del proyecto. Las creaciones con organización explícita válida se mantienen.
- Para creaciones POST con tenant implícito, la policy fija `data.organization` a la primera organización cuyo rol autoriza la acción, en lugar de permitir que el controlador elija la primera membresía arbitraria. Los controladores siguen validando los campos obligatorios del recurso.
- Las relaciones de tenant aceptan documentId como string, `{ documentId }`, `connect: [string | { documentId }]` y `set: [string | { documentId }]`, siempre una sola relación. Desconexiones, null, múltiples destinos o sintaxis ambigua en `organization`/`project` se rechazan; ya no se interpretan como «campo omitido». No se añaden IDs numéricos como alias de documentId.
- Meeting-note y bug comparten el extractor de relaciones para que un `set` autorizado de proyecto también se aplique en la escritura.

## Defensa en controladores

Meeting-note y bug reautorizan por sí mismos create/update; bug también aplica alcance propio a `listSummary`. No necesitan que una policy de ruta se haya ejecutado antes para esas acciones.

La revisión del patrón «resolver destino antes de autorizar origen» añadió la misma comprobación independiente al update de:

- delivery-unit y delivery-activity-template;
- project-story-map, project-module, project-persona-role y project-proposal;
- sprint, test-case-template y test-plan;
- test-run, test-run-result y test-cycle-execution;
- functionality, test-case y project.

`test-cycle-execution.persist` también autoriza origen antes de deduplicar o escribir.

Se mantienen los roles de sus rutas: MANAGE, ENGINEERING o ADMIN según el recurso. El resto de la validación funcional de estos controladores no se modifica. La comprobación de policy cubre las operaciones por documentId de las rutas configuradas, incluidas lecturas y borrados; esto no equivale a introducir un middleware global de servicios ni a auditar todos los servicios internos/bulk.

## Regresiones y ejecución aislada

Pruebas nuevas:

- `src/policies/tenant-isolation.test.ts`: origen extranjero con destino propio; Owner A/Viewer B; roles por tenant en creación y listados; origen/destino de proyecto restringido; CRUD autorizado en A; traslado permitido dentro de A; prohibición de cambio de tenant aun con ambos Owner; mismatches proyecto/organización; relaciones set/connect/desconexión; destino inexistente; filtros/paginación; creación implícita y sin params.
- `src/policies/tenant-controller-isolation.test.ts`: invocación directa de controladores, sin ejecutar guards de ruta, rechazo antes de update/create y casos positivos reales de creación/traslado; alcance de consulta summary.
- `src/policies/tenant-core-routes.test.ts`: genera rutas usando la factory real de Strapi instalada, comprueba su parámetro `:id` y verifica rechazo de origen extranjero y acceso propio en GET/PUT/DELETE. Evidencia adicional RED→GREEN: `core-router-{red,green}.log`.
- `src/utils/tenant-memberships.test.ts`: impide que consultar membresías acepte invitaciones por email o reactive una membresía inactiva; conserva acceso de miembros activos. Evidencia: `membership-bypass-{red,green}.log`.
- `src/utils/tenant-test-fixture.ts`: repositorios documentales simulados, usuario, membresías y proyectos en memoria. Ninguna BD real ni inicio de Strapi.

Runtime verificado: `C:/Users/Kimberly Conde/AppData/Roaming/nvm/v20.20.2/node.exe` (Node 20). Se ejecuta explícitamente, sin cambiar PATH/nvm. Comando dirigido desde `api`:

```bash
"C:/Users/Kimberly Conde/AppData/Roaming/nvm/v20.20.2/node.exe" \
  --require "C:/Users/Kimberly Conde/AppData/Local/hermes/cache/scratch/qa-audit-no-network.cjs" \
  --import tsx --test \
  src/policies/tenant-access.test.ts \
  src/policies/tenant-isolation.test.ts \
  src/policies/tenant-controller-isolation.test.ts \
  src/utils/tenant.test.ts
```

Resultado dirigido final: **47 PASS, 0 FAIL** (`tenant-final-green.log`). Comprobación TypeScript con `node.exe node_modules/typescript/bin/tsc --noEmit --incremental false`: **exit 0** (`tenant-tsc.log`). Ejecución de los **29 archivos** `src/**/*.test.ts`, secuencial y con bloqueo de sockets: **187 PASS, 0 FAIL** (`tenant-full-suite.log`). La suite completa incluye cambios locales de otros trabajos concurrentes, no sólo los archivos de esta corrección.

### Evidencia RED → GREEN

Logs locales fuera del repositorio, en `C:/Users/Kimberly Conde/AppData/Local/hermes/cache/scratch/`:

| Logs | Comportamiento observado primero en RED y después corregido |
| --- | --- |
| `tenant-01-{red,green}.log` | La autorización de destino ocurría antes de consultar origen extranjero. |
| `tenant-02-{red,green}.log` | Owner A autorizaba escritura de Viewer B y el listado incluía B para rol Owner. |
| `tenant-03-{red,green}.log` | B restringido contaminaba CRUD de A; destino asignado ocultaba origen restringido; cambio de organización permitido. |
| `tenant-04-{red,green}.log` | Organización explícita ocultaba proyecto extranjero y relaciones de desconexión/reemplazo evitaban validación. |
| `tenant-05-{red,green}.log` | Meeting-note y bug directos aceptaban update de recurso extranjero con destino propio. |
| `tenant-06-{red,green}.log` | Otros controladores con el mismo patrón no autorizaban primero el origen. |
| `tenant-07-{red,green}.log` | Creación directa en B aceptada con rol Viewer. |
| `tenant-08-{red,green}.log` | Bug summary directo no añadía filtros de alcance. |
| `tenant-09-{red,green}.log` | Creación implícita no vinculaba un tenant con rol autorizado. |
| `tenant-10-{red,green}.log` | `set` de proyecto autorizado no se aplicaba en meeting-note/bug. |
| `tenant-11-{red,green}.log` | Creación sin params fallaba; suite dirigida en GREEN con bloqueo de sockets. |
| `tenant-12-{red,green}.log` | Functionality, test-case, project y persist de ejecución aceptaban origen extranjero con destino propio. |

No se ejecutaron migraciones, operaciones sobre BD, servidor Strapi, E2E, commits, push ni despliegues.

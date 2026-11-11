# Wireframes lo-fi con Stitch

## Alcance del MVP

En **Acerca de → Insights con IA y brief de wireframe**:

1. Opcionalmente generar el análisis de IA como apoyo; no es un requisito previo para el brief.
2. Completar o revisar la información de **Acerca de**: descripción, objetivo, requisitos básicos y normas empresariales. No hay un campo de confirmación manual del análisis.
3. Generar el brief. El servidor lee la información guardada del proyecto autorizado como fuente principal y usa el análisis de IA, si existe, como apoyo. También puede generar el brief sin análisis previo; los supuestos permanecen identificados como tales. Ambos proveedores reciben la política lo-fi y los mismos criterios de UI/UX.
4. Revisar el brief y pulsar **Generar flujo lo-fi**. Confirmar el envío a Stitch únicamente si no contiene secretos o información confidencial.
5. Consultar el recorrido propuesto del brief y el conjunto ordenado de pantallas en una versión de la galería, ampliar sus imágenes o usar **Abrir en Stitch**. Las versiones anteriores se conservan.

Cada solicitud realiza **una sola generación MCP** para un flujo desktop simple de principio a fin, en un proyecto privado de Stitch por versión. Se piden las pocas escenas necesarias, normalmente 4–7, aceptando 2–12 pantallas únicas; no se fuerzan login/dashboard ni pantallas de estado irrelevantes. Una sola pantalla se conserva como resultado parcial, no se declara un flujo completo. La galería se adapta a móvil; esto no equivale a generar un diseño mobile. El MVP no incluye el editor de Stitch embebido ni ejecuta HTML generado.

## Configuración local

El backend lee `STITCH_API_KEY` desde su entorno. No colocar la clave en variables `VITE_*`, frontend, Git, capturas ni logs. Si cambia el entorno de un backend ya iniciado, hace falta reiniciar ese proceso para que lo reciba.

La función agrega el tipo privado `api::stitch-wireframe.stitch-wireframe`. Su tabla, índices y sincronización se deben verificar en una base aislada antes de usarla con datos reales. No iniciar Strapi contra una base desconocida para “probar”: el arranque puede sincronizar esquema.

Se agregan `api::ai.ai.listProjectWireframes` y `api::ai.ai.generateProjectWireframe` al registro de acciones; el bootstrap existente gestiona el rol Authenticated. Roles locales personalizados pueden requerir sus grants exactos. Nunca conceder acceso Public ni cambiar roles de cuentas como solución genérica. El controlador exige usuario autenticado y el servicio verifica organización/proyecto y roles; generación requiere roles de gestión y acceso al plan IA.

## API

- GET `/api/ai/project/wireframes?projectId=<documentId>` devuelve `{data:{configured,versions}}`.
- POST `/api/ai/project/wireframes` recibe `{data:{projectId,requestId,confirmedExternalSend:true}}`. `requestId` es UUID; se conserva para reconciliar resultados inciertos, no se genera otro automáticamente ante un timeout.

Los registros e imágenes son privados y se proyectan en DTOs autorizados. No existe CRUD público del tipo interno. Las pantallas nuevas se almacenan en el JSON privado existente `metadata.screens` (identificador, título e imagen PNG base64 validada), sin nueva migración de esquema. Se conservan la lectura de `metadata.screenName`/`title` y `imageDataUrl` de las versiones históricas de una pantalla. `flowSummary` es una proyección textual acotada de la sección guardada «Flujo recomendado entre escenas»; si falta, se muestra un extracto del brief. La secuencia es el orden devuelto por Stitch, no conexiones verificadas ni transiciones automáticas; la galería es estática, no un prototipo navegable. Cada pantalla se proyecta con una allowlist, sin HTML ni metadatos privados; no se depende de cookies del navegador para verla. El enlace a Stitch sí requiere acceso a ese proyecto en la cuenta del proveedor.

## Errores y consumo

Doble clic usa una sola solicitud. Si la respuesta se pierde, no se repite automáticamente la generación. Los estados **Resultado parcial** y **Resultado por verificar** conservan el bloqueo del proyecto para evitar duplicados y gasto. Actualizar consulta el estado guardado; no reenvía el brief.

La conciliación de estados parciales/inciertos es manual en este MVP y no existe aún un endpoint de recuperación. Abrir el proyecto de Stitch sirve para revisar el resultado, pero no libera por sí solo el bloqueo local. No editar directamente la base sin investigar el intento y su consumo.

Un flujo completo puede consumir más cuota del proveedor que una pantalla; se explica antes de confirmar, sin inventar límites ni precios. Se registra un uso IA interno por solicitud completada, no uno por pantalla. La cuota de Stitch y el contador IA de QA Tracker son mecanismos distintos. La configuración de una clave no establece límites/costos comerciales del proveedor.

## Límites y verificación

- El historial todavía no tiene paginación: no hay corte funcional en la versión 101, pero antes de escalar conviene paginar imágenes/versiones en servidor y cliente.
- Una generación tiene un plazo global máximo de 300 segundos; cada respuesta tiene un máximo de 5,5 MB y cada imagen/DTO un máximo de 4 millones de caracteres. Se aceptan hasta 12 pantallas únicas y se acota la respuesta cruda a 120 registros para tolerar repeticiones sin trabajo ilimitado.
- Los identificadores generados se validan y deduplican antes de descargar; se guardan todos antes de la primera descarga. Se verifican los detalles de todas las pantallas contra el proyecto. El servidor solo envía la clave al origen exacto `https://stitch.googleapis.com`, rechaza redirecciones y valida base64 canónico y firma PNG. Cada imagen se guarda y relee antes de continuar. Si una descarga falla, se conservan los identificadores y las imágenes anteriores y se intentan las demás descargas sin regenerar.
- Política lo-fi obligatoria en el prompt no garantiza obediencia visual del modelo; revisar la salida.
- Pruebas unitarias bloquean sockets y la regresión de navegador usa HTTP sintético; no prueban persistencia SQL, autenticación de una cuenta real ni sincronización de esquema.
- La prueba previa del proveedor verificó recuperación real de una pantalla ficticia, no la generación de un flujo multipantalla. Esa nueva capacidad sigue pendiente de validación con Stitch real. El contrato descubierto de `generate_screen_from_text` también admite texto/sugerencias; el prompt no garantiza que devuelva todo el conjunto en una llamada. Si devuelve solo una pantalla, queda parcial; si no devuelve pantallas, no se declara completado ni se reenvía automáticamente. No regenerar como parte de pruebas de rutina.
- No publicar ni desplegar como parte de una comprobación local.

### Comandos de verificación offline

Ejecutar desde cada repositorio con un directorio externo existente en `QA_SECURITY_SCRATCH`:

```bash
# api
npm test -- --test-concurrency=1
node node_modules/typescript/bin/tsc --noEmit --incremental false

# client
npm run test:unit -- --test-concurrency=1
node scripts/test-stitch-gallery.test.mjs
node node_modules/typescript/bin/tsc --noEmit --incremental false
```

La regresión de navegador cubre versiones históricas de una pantalla, generación de una versión de varias pantallas, recorrido propuesto, orden, lectura, ampliación disponible, enlace, cancelación, doble envío, viewer, brief requerido, fallo de lectura, resultado incierto/parcial, contenido no confiable y confirmación a 390px. No usa una clave real.


## Estándares de UI/UX del prompt

El brief y la instrucción directa a Stitch comparten la misma política: objetivo/actor, entrada → tarea principal → revisión o confirmación pertinente → resultado; navegación y componentes consistentes; jerarquía clara y una acción primaria por contexto; campos mínimos y divulgación progresiva. Se piden etiquetas persistentes, ayuda, requerido/opcional, validación inline y resumen de errores accionable, volver/cancelar sin pérdida de datos y revisión antes de envíos irreversibles/destructivos cuando corresponda. Los estados vacío/cargando/error/éxito se representan donde aporten valor, no como pantallas obligatorias separadas.

Se solicitan anotaciones de teclado, foco lógico/visible y contraste suficiente en grises; interfaz en español, bordes finos y controles básicos sin color de marca ni acabado visual pulido. Sin patrones oscuros ni integraciones inventadas. Los datos aportados por el cliente guían el flujo; el análisis de IA no los sustituye ni inventa aprobaciones. Estas instrucciones no certifican WCAG ni garantizan calidad visual; la revisión humana del flujo sigue siendo necesaria.

Referencias de diseño (adaptar al dominio; no son una solución universal):
- W3C WAI, formularios: https://www.w3.org/WAI/tutorials/forms/
- W3C WAI, notificaciones: https://www.w3.org/WAI/tutorials/forms/notifications/
- W3C WAI, formularios por pasos: https://www.w3.org/WAI/tutorials/forms/multi-page/
- GOV.UK, revisión de respuestas: https://design-system.service.gov.uk/patterns/check-answers/
- GOV.UK, confirmación: https://design-system.service.gov.uk/patterns/confirmation-pages/

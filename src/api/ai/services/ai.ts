import { errors } from '@strapi/utils';
import { normalizeGeminiError } from '../../../utils/ai-provider-errors';

const GEMINI_MODEL = 'gemini-3.5-flash';
const GROQ_MODEL = 'llama-3.1-8b-instant';

type ProjectInsightInput = {
  name: string;
  description?: string;
  purpose?: string;
  coreRequirements?: string[];
  businessRules?: string;
};

type ExecutionRecommendationCandidate = {
  id: string;
  name: string;
  module: string;
  priority: string;
  riskLevel: string;
  isCore: boolean;
  isRegression: boolean;
  isSmoke: boolean;
  lastFunctionalChangeAt?: string;
  roles: string[];
  testCaseCount: number;
};

type ExecutionRecommendation = {
  functionalityId: string;
  reason: string;
};

type DeliveryUnitSummaryInput = {
  deliveryUnit: {
    name: string;
    type?: string;
    status?: string;
    periodLabel?: string;
    startDate?: string;
    estimatedEndDate?: string;
    baseDescription?: string;
  };
  activities: Array<{
    name?: string;
    description?: string;
  }>;
  functionalities: Array<{
    name?: string;
    status?: string;
    priority?: string;
    module?: string;
  }>;
  metrics?: {
    totalFunctionalities?: number;
    completed?: number;
    inProgress?: number;
    pending?: number;
    activeBugs?: number;
    testCasesCount?: number;
    progressPercent?: number;
  };
};

type TechnicalReportAnalysisInput = {
  reportType: string;
  reportTitle: string;
  reportPurpose: string;
  scope?: Record<string, unknown>;
  metrics?: Record<string, unknown>;
  highlights?: unknown[];
  risks?: unknown[];
  details?: Record<string, unknown>;
};

type GeneratedAiTestCase = {
  title?: unknown;
  description?: unknown;
  preconditions?: unknown;
  testSteps?: unknown;
  expectedResult?: unknown;
  testType?: unknown;
  priority?: unknown;
};

function getEnvValue(value: unknown) {
  return String(value || '').trim();
}

function getGeminiApiKey() {
  return getEnvValue(process.env.GEMINI_API_KEY) || getEnvValue(process.env.VITE_GEMINI_API_KEY);
}

function getGroqApiKey() {
  return getEnvValue(process.env.GROQ_API_KEY) || getEnvValue(process.env.VITE_GROQ_API_KEY);
}

function isAiProviderConfigured() {
  return Boolean(getGeminiApiKey() || getGroqApiKey());
}

function shouldFallbackToGroq(error: unknown) {
  const raw: any = (error as any)?.error ?? error;
  const status = raw?.status;
  const code = raw?.code;
  const message = (raw?.message || raw?.error?.message || (error as any)?.message || '')
    .toString()
    .toLowerCase();

  return (
    code === 429 ||
    code === 404 ||
    code === 503 ||
    status === 404 ||
    status === 503 ||
    status === 'RESOURCE_EXHAUSTED' ||
    status === 'UNAVAILABLE' ||
    message.includes('quota exceeded') ||
    message.includes('resource_exhausted') ||
    message.includes('rate limit') ||
    message.includes('too many requests') ||
    message.includes('high demand') ||
    message.includes('experiencing high demand') ||
    message.includes('currently overloaded') ||
    message.includes('model is overloaded') ||
    message.includes('try again later') ||
    message.includes('api key not valid') ||
    message.includes('reported as leaked')
  );
}

function extractJsonPayload<T>(rawText: string): T {
  const trimmed = rawText.trim();
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fencedMatch ? fencedMatch[1].trim() : trimmed;

  try {
    return JSON.parse(candidate) as T;
  } catch {
    const firstObject = candidate.indexOf('{');
    const firstArray = candidate.indexOf('[');
    const jsonStart =
      firstObject === -1
        ? firstArray
        : firstArray === -1
          ? firstObject
          : Math.min(firstObject, firstArray);

    const lastObject = candidate.lastIndexOf('}');
    const lastArray = candidate.lastIndexOf(']');
    const jsonEnd = Math.max(lastObject, lastArray);

    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      return JSON.parse(candidate.slice(jsonStart, jsonEnd + 1)) as T;
    }

    throw new Error('AI_PROVIDER_INVALID_JSON');
  }
}

function extractGeminiText(payload: any) {
  const parts = payload?.candidates?.[0]?.content?.parts;

  if (!Array.isArray(parts)) {
    throw new Error('AI_PROVIDER_EMPTY_RESPONSE');
  }

  const text = parts
    .map((part: any) => (typeof part?.text === 'string' ? part.text : ''))
    .join('')
    .trim();

  if (!text) {
    throw new Error('AI_PROVIDER_EMPTY_RESPONSE');
  }

  return text;
}

function normalizeAiText(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .map(item => `${item ?? ''}`.trim())
      .filter(Boolean)
      .map(item => `- ${item}`)
      .join('\n');
  }

  if (typeof value === 'string') {
    return value;
  }

  if (value == null) {
    return '';
  }

  return String(value);
}

function normalizeAiLine(value: unknown) {
  return String(value ?? '')
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '');
}

function normalizeAiTextBlock(value: unknown, options?: { numbered?: boolean }) {
  if (Array.isArray(value)) {
    const items = value.map(normalizeAiLine).filter(Boolean);

    if (items.length === 0) {
      return '';
    }

    if (options?.numbered) {
      return items.map((item, index) => `${index + 1}. ${item}`).join('\n');
    }

    return items.join('\n');
  }

  return normalizeAiLine(value);
}

function normalizeGeneratedTestCase(testCase: GeneratedAiTestCase) {
  return {
    title: normalizeAiTextBlock(testCase?.title),
    description: normalizeAiTextBlock(testCase?.description),
    preconditions: normalizeAiTextBlock(testCase?.preconditions),
    testSteps: normalizeAiTextBlock(testCase?.testSteps, { numbered: true }),
    expectedResult: normalizeAiTextBlock(testCase?.expectedResult),
    testType: normalizeAiTextBlock(testCase?.testType) || 'Funcional',
    priority: normalizeAiTextBlock(testCase?.priority) || 'Medio',
  };
}

function buildTechnicalReportPrompt(input: TechnicalReportAnalysisInput) {
  const sharedContext = `Contexto del reporte:
- Tipo: ${input.reportType}
- Titulo: ${input.reportTitle}
- Proposito: ${input.reportPurpose}

Alcance:
${JSON.stringify(input.scope || {}, null, 2)}

Metricas:
${JSON.stringify(input.metrics || {}, null, 2)}

Hallazgos base:
${JSON.stringify(input.highlights || [], null, 2)}

Riesgos base:
${JSON.stringify(input.risks || [], null, 2)}

Detalle adicional:
${JSON.stringify(input.details || {}, null, 2)}`;

  if (input.reportType === 'qa-status-summary') {
    return `Genera un analisis ejecutivo y tecnico del reporte QA utilizando exclusivamente los datos suministrados.

${sharedContext}

IMPORTANTE:
- No uses markdown.
- No uses asteriscos (**).
- No uses tablas markdown.
- No uses lenguaje exageradamente robotico.
- Manten un tono profesional, ejecutivo y facil de leer.
- Usa parrafos cortos.
- Usa titulos simples y limpios.
- El analisis debe sentirse como un reporte real de QA para clientes o lideres tecnicos.
- No inventes informacion no presente en los datos.
- Si faltan datos importantes, indicalo de forma profesional y breve.
- Evita repetir metricas innecesariamente.

La estructura debe ser:

1. Estado general del ciclo
Resumen ejecutivo corto del estado del ciclo.

2. Observaciones relevantes
Hallazgos importantes sobre cobertura, calidad, estabilidad y automatizacion.

3. Riesgos identificados
Posibles riesgos tecnicos o de proceso detectados.

4. Recomendaciones
Acciones sugeridas basadas en los datos actuales.

5. Informacion sugerida para proximos reportes
Datos adicionales que ayudarian a mejorar el analisis.

El analisis debe basarse unicamente en:
- metricas del reporte
- funcionalidades incluidas
- bugs relacionados
- resultados de ejecucion
- modulos impactados
- nivel de automatizacion
- cobertura
- datos del ciclo

Responde solo con el contenido final del analisis, sin notas previas ni cierre adicional.`;
  }

  if (input.reportType === 'qa-progress-report') {
    return `Genera un analisis ejecutivo y tecnico del reporte de progreso QA utilizando unicamente los datos suministrados.

${sharedContext}

IMPORTANTE:
- No uses markdown.
- No uses asteriscos.
- No uses lenguaje academico exagerado.
- No dramatices riesgos.
- Manten un tono profesional, ejecutivo y claro.
- Usa parrafos cortos y faciles de leer.
- Evita repetir metricas innecesariamente.
- El resultado debe parecer un informe real generado para lideres QA, CTOs o clientes.
- No inventes informacion que no exista en los datos.
- Si faltan datos importantes, indicalo de forma breve y profesional.

El analisis debe incluir:

1. Evolucion del sprint
Resumen breve del comportamiento general entre ciclos.

2. Aspectos destacados
Hallazgos relevantes sobre estabilidad, cobertura, automatizacion y ejecucion.

3. Riesgos actuales
Riesgos identificados segun las metricas disponibles.

4. Recomendaciones sugeridas
Acciones practicas basadas en los resultados del reporte.

5. Informacion adicional recomendada
Datos que ayudarian a enriquecer futuros analisis.

El analisis debe basarse exclusivamente en:
- ciclos ejecutados
- tasa de aprobacion
- bugs encontrados
- cobertura
- automatizacion
- metricas de evolucion
- frecuencia de ejecucion
- funcionalidades incluidas
- resultados del ciclo

Responde solo con el contenido final del analisis, sin notas previas ni cierre adicional.`;
  }

  if (input.reportType === 'project-status-report') {
    return `Genera un analisis ejecutivo y tecnico del estado del proyecto utilizando unicamente los datos suministrados.

${sharedContext}

IMPORTANTE:
- No uses markdown.
- No uses asteriscos.
- No uses lenguaje academico exagerado.
- No dramatices riesgos.
- Manten un tono profesional, ejecutivo y claro.
- Usa parrafos cortos y faciles de leer.
- Evita repetir metricas innecesariamente.
- El resultado debe parecer un informe real para lideres QA, gerencia, CTOs o clientes.
- No inventes informacion que no exista en los datos.
- Si faltan datos importantes, indicalo de forma breve y profesional.

El analisis debe incluir:

1. Estado general del proyecto
Resumen breve del avance funcional y del estado global del proyecto.

2. Aspectos destacados
Hallazgos relevantes sobre cobertura, avance, calidad, automatizacion y composicion del alcance.

3. Riesgos actuales
Riesgos identificados segun las metricas disponibles, sin sobredimensionarlos.

4. Recomendaciones sugeridas
Acciones practicas basadas en el estado actual del proyecto.

5. Informacion adicional recomendada
Datos que ayudarian a enriquecer futuros analisis.

El analisis debe basarse exclusivamente en:
- avance funcional
- funcionalidades incluidas
- casos de prueba
- bugs activos
- promedio de ciclos
- automatizacion
- riesgos funcionales
- pruebas pendientes o bloqueadas
- composicion del alcance

Responde solo con el contenido final del analisis, sin notas previas ni cierre adicional.`;
  }

  if (input.reportType === 'delivery-unit-progress-report') {
    return `Genera un analisis ejecutivo y tecnico del progreso por unidad utilizando unicamente los datos suministrados.

${sharedContext}

IMPORTANTE:
- No uses markdown.
- No uses asteriscos.
- No uses lenguaje academico exagerado.
- No dramatices riesgos.
- Manten un tono profesional, ejecutivo y claro.
- Usa parrafos cortos y faciles de leer.
- Evita repetir metricas innecesariamente.
- El resultado debe parecer un informe real para lideres QA, responsables del proyecto o clientes.
- No inventes informacion que no exista en los datos.
- Si faltan datos importantes, indicalo de forma breve y profesional.

El analisis debe incluir:

1. Estado general de la unidad
Resumen breve del avance funcional y operativo de la unidad.

2. Aspectos destacados
Hallazgos relevantes sobre progreso, cobertura, calidad, riesgos y actividades ejecutadas.

3. Riesgos actuales
Riesgos identificados segun las metricas y el estado del alcance asociado.

4. Recomendaciones sugeridas
Acciones practicas basadas en el estado actual de la unidad.

5. Informacion adicional recomendada
Datos que ayudarian a enriquecer futuros analisis.

El analisis debe basarse exclusivamente en:
- unidad seleccionada
- actividades realizadas
- funcionalidades asociadas
- estados funcionales
- bugs activos
- cobertura por casos
- progreso general
- riesgo funcional
- periodo y estado de la unidad

Responde solo con el contenido final del analisis, sin notas previas ni cierre adicional.`;
  }

  return `Actua como lead QA tecnico y analista de calidad de software.
Debes producir un analisis tecnico enfocado en el proposito del reporte, usando solo la data suministrada.

${sharedContext}

Instrucciones:
- Responde en espanol.
- Usa un tono tecnico, concreto y accionable.
- Prioriza interpretacion de datos, tendencias, riesgos y decisiones QA.
- No inventes metricas, integraciones ni causas que no se desprendan del contexto.
- Si hay vacios de informacion, dilo explicitamente como limitacion del analisis.
- Adapta el enfoque al tipo de reporte y su finalidad.

Responde solo en Markdown con estas secciones exactas:
## Lectura tecnica
## Hallazgos clave
## Riesgos y alertas
## Recomendaciones accionables
## Datos faltantes o validaciones sugeridas`;
}

async function requestGeminiCompletion(prompt: string, responseMimeType?: 'application/json') {
  const apiKey = getGeminiApiKey();

  if (!apiKey) {
    throw new Error('GEMINI_API_KEY_MISSING');
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: responseMimeType ? { responseMimeType } : undefined,
      }),
    },
  );

  const payload = (await response.json().catch(() => null)) as any;

  if (!response.ok) {
    normalizeGeminiError(payload || new Error(`Gemini request failed with status ${response.status}`));
  }

  return extractGeminiText(payload);
}

async function requestGroqCompletion(prompt: string) {
  const apiKey = getGroqApiKey();

  if (!apiKey) {
    throw new Error('GROQ_API_KEY_MISSING');
  }

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content:
            'Eres un asistente de QA. Responde exactamente en el formato solicitado y no agregues texto fuera de ese formato.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
    }),
  });

  const payload = (await response.json().catch(() => null)) as any;

  if (!response.ok) {
    const errorMessage =
      payload?.error?.message || `Groq request failed with status ${response.status}`;
    throw new Error(errorMessage);
  }

  const text = payload?.choices?.[0]?.message?.content?.trim();

  if (!text) {
    throw new Error('AI_PROVIDER_EMPTY_RESPONSE');
  }

  return text;
}

async function withAiFallback<T>(
  geminiRequest: () => Promise<T>,
  groqRequest: () => Promise<T>,
) {
  const hasGemini = Boolean(getGeminiApiKey());
  const hasGroq = Boolean(getGroqApiKey());

  if (!hasGemini && !hasGroq) {
    throw new Error('AI_PROVIDER_MISSING');
  }

  if (hasGemini) {
    try {
      return await geminiRequest();
    } catch (error) {
      if (hasGroq && shouldFallbackToGroq(error)) {
        strapi.log.warn('Gemini no disponible, usando fallback Groq.');
        return groqRequest();
      }

      throw error;
    }
  }

  return groqRequest();
}

function buildProjectContext(input: ProjectInsightInput) {
  return `Proyecto: ${input.name}
Descripcion general: ${input.description || 'No definida'}
Objetivo del proyecto:
${input.purpose || 'No definido'}

Requisitos básicos:
${(input.coreRequirements || []).join('\n') || 'No definidos'}

Normas empresariales:
${input.businessRules || 'No definidas'}`;
}

async function ensureAiEnabled(userId: number, projectId: string) {
  await strapi.service('api::plan-access.plan-access').authorizeAi(userId, projectId);
}

async function consumeAiUsage(userId: number, projectId: string) {
  await strapi.service('api::plan-access.plan-access').consumeAiUsage(userId, projectId, 1);
}

function rethrowAiError(error: unknown): never {
  const message = (error instanceof Error ? error.message : String(error || '')).trim();

  if (
    message === 'AI_PROVIDER_MISSING' ||
    message === 'GEMINI_API_KEY_INVALID' ||
    message === 'GEMINI_API_KEY_LEAKED'
  ) {
    throw new errors.ApplicationError(message);
  }

  if (message === 'AI_PROVIDER_INVALID_JSON' || message === 'AI_PROVIDER_EMPTY_RESPONSE') {
    throw new errors.ApplicationError('La respuesta del proveedor IA no fue válida.');
  }

  throw error instanceof Error
    ? new errors.ApplicationError(error.message)
    : new errors.ApplicationError('No se pudo completar la solicitud de IA.');
}

async function runAiAction<T>(userId: number, projectId: string, action: () => Promise<T>) {
  await ensureAiEnabled(userId, projectId);

  try {
    const result = await action();
    await consumeAiUsage(userId, projectId);
    return result;
  } catch (error) {
    rethrowAiError(error);
  }
}

export default () => ({
  getProviderStatus() {
    return {
      configured: isAiProviderConfigured(),
      providers: {
        gemini: Boolean(getGeminiApiKey()),
        groq: Boolean(getGroqApiKey()),
      },
    };
  },

  async generateTestCases(
    userId: number,
    input: { projectId: string; functionalityName: string; moduleName: string },
  ) {
    const prompt = `Genera 1 caso de prueba de camino feliz para la funcionalidad "${input.functionalityName}" del módulo "${input.moduleName}".
Debe ser el escenario principal más representativo para el usuario final.

Responde solo con JSON válido:
{
  "title": "",
  "description": "",
  "preconditions": "",
  "testSteps": "",
  "expectedResult": "",
  "testType": "Funcional",
  "priority": "Medio"
}

Usa testType solo de esta lista: Integración, Funcional, Sanity, Regresión, Smoke, Exploratoria, UAT.
Usa priority solo de esta lista: Crítico, Alto, Medio, Bajo.`;

    return runAiAction(userId, input.projectId, () =>
      withAiFallback(
        async () => {
          const text = await requestGeminiCompletion(prompt, 'application/json');
          const parsed = extractJsonPayload<any>(text);
          const normalized = Array.isArray(parsed) ? parsed.slice(0, 1) : [parsed];
          return normalized.map(item => normalizeGeneratedTestCase(item));
        },
        async () => {
          const parsed = extractJsonPayload<any>(
            await requestGroqCompletion(
              `${prompt}\n\nResponde unicamente con JSON valido. No uses Markdown ni texto adicional.`,
            ),
          );
          const normalized = Array.isArray(parsed) ? parsed.slice(0, 1) : [parsed];
          return normalized.map(item => normalizeGeneratedTestCase(item));
        },
      ),
    );
  },

  async improveMeetingNotes(userId: number, input: { projectId: string; notes: string }) {
    const prompt = `Resume estas notas de reunion para QA/producto.

Objetivo:
- ahorrar tokens
- mantener lo importante
- entregar un resultado practico y accionable

Reglas:
- summary: 1 parrafo corto, claro y especifico
- decisions: maximo 3 bullets
- actions: maximo 5 bullets, orientadas a tareas concretas
- nextSteps: maximo 3 bullets
- no inventes informacion
- conserva nombres, modulos, tickets y pendientes si aparecen
- si una seccion no aplica, devuelve array vacio o string vacio

Notas originales:
${input.notes}

Responde solo JSON valido con este formato:
{
  "summary": "",
  "decisions": [],
  "actions": [],
  "nextSteps": []
}`;

    return runAiAction(userId, input.projectId, () =>
      withAiFallback(
        async () => {
          const text = await requestGeminiCompletion(prompt, 'application/json');
          const result = extractJsonPayload<{
            summary?: unknown;
            decisions?: unknown;
            actions?: unknown;
            nextSteps?: unknown;
          }>(text);

          return {
            summary: normalizeAiText(result?.summary),
            decisions: normalizeAiText(result?.decisions),
            actions: normalizeAiText(result?.actions),
            nextSteps: normalizeAiText(result?.nextSteps),
          };
        },
        async () => {
          const result = extractJsonPayload<{
            summary?: unknown;
            decisions?: unknown;
            actions?: unknown;
            nextSteps?: unknown;
          }>(
            await requestGroqCompletion(`${prompt}\n\nResponde unicamente con JSON valido.`),
          );

          return {
            summary: normalizeAiText(result?.summary),
            decisions: normalizeAiText(result?.decisions),
            actions: normalizeAiText(result?.actions),
            nextSteps: normalizeAiText(result?.nextSteps),
          };
        },
      ),
    );
  },

  async recommendExecutionFunctionalities(
    userId: number,
    input: {
      projectId: string;
      testType: string;
      selectedModules: string[];
      selectedFunctionalities: ExecutionRecommendationCandidate[];
      candidateFunctionalities: ExecutionRecommendationCandidate[];
      maxSuggestions?: number;
    },
  ) {
    const maxSuggestions = Math.max(1, Math.min(input.maxSuggestions || 5, 5));

    const prompt = `Actua como analista QA senior.
Necesito sugerencias cortas de funcionalidades adicionales para una ejecución de pruebas.

Contexto actual:
- Tipo de prueba: ${input.testType}
- Modulos seleccionados: ${input.selectedModules.join(', ') || 'Ninguno'}
- Funcionalidades ya seleccionadas:
${JSON.stringify(input.selectedFunctionalities, null, 2)}

Candidatas posibles:
${JSON.stringify(input.candidateFunctionalities, null, 2)}

Reglas:
- Devuelve máximo ${maxSuggestions} sugerencias.
- Usa solo functionalityId presentes en "Candidatas posibles".
- Prioriza impacto por: mismo módulo, cambio reciente, core, riesgo alto, prioridad alta, y afinidad con el tipo de prueba.
- El motivo debe ser breve, concreto y en español.
- Si no hay candidatas suficientemente relevantes, devuelve un array vacio.

Responde unicamente con JSON valido usando este formato:
[
  {
    "functionalityId": "ID",
    "reason": "Motivo corto"
  }
]`;

    return runAiAction(userId, input.projectId, () =>
      withAiFallback(
        async () => {
          const text = await requestGeminiCompletion(prompt, 'application/json');
          return extractJsonPayload<ExecutionRecommendation[]>(text);
        },
        async () =>
          extractJsonPayload<ExecutionRecommendation[]>(
            await requestGroqCompletion(`${prompt}\n\nResponde unicamente con JSON valido.`),
          ),
      ),
    );
  },

  async analyzeProject(
    userId: number,
    input: { projectId: string; input: ProjectInsightInput },
  ) {
    const prompt = `Actúa como consultor senior de gestión de proyectos y QA.
Analiza la siguiente información del proyecto y devuelve recomendaciones útiles en español.

${buildProjectContext(input.input)}

Necesito una respuesta en Markdown con estas secciones exactas:
## Resumen ejecutivo
## Desafíos probables
## Riesgos y dependencias
## Vacíos de definición
## Recomendaciones de gestión
## Sugerencias QA
## Preguntas para validar con el cliente

Reglas:
- Sé concreto y accionable.
- Enfatiza hallazgos que ayuden a planificar, priorizar y alinear al equipo.
- No inventes integraciones técnicas no mencionadas.
- Si falta información, dilo como supuesto o pregunta abierta.

Responde solo con Markdown.`;

    return runAiAction(userId, input.projectId, () =>
      withAiFallback(
        async () => (await requestGeminiCompletion(prompt)).trim(),
        async () => (await requestGroqCompletion(prompt)).trim(),
      ),
    );
  },

  async generateProjectWireframeBrief(
    userId: number,
    payload: { projectId: string; input: ProjectInsightInput },
  ) {
    const input = payload.input;
    const coreRequirements = (input.coreRequirements || []).join('\n') || 'No definidos';
    const businessRules = input.businessRules || 'No definidas';
    const description = input.description || 'No definida';
    const purpose = input.purpose || 'No definido';

    const prompt = `Act as a senior product designer and UX strategist.
Using the real project information below, generate a reusable wireframe brief in Markdown.
The result must keep a structure similar to a multi-screen low-fidelity wireframe request, but it must adapt to the actual project context instead of forcing generic screens.

Project context:
- Project name: ${input.name}
- General description: ${description}
- Project goal: ${purpose}
- Core requirements:
${coreRequirements}
- Business rules:
${businessRules}

Return the answer in Spanish, but keep the final block "Wireframe prompt listo para pegar" written in English so it can be pasted directly into Stitch or a similar wireframing tool.

Necesito una respuesta en Markdown con estas secciones exactas:
## Objetivo del wireframe
## Usuarios principales
## Escenas principales sugeridas
## Contenido clave por escena
## Componentes sugeridos
## Flujo recomendado entre escenas
## Consideraciones de negocio
## Wireframe prompt listo para pegar

Reglas:
- Propone entre 4 y 7 escenas principales.
- Las escenas deben ser sencillas, editables y pensadas para una primera versión.
- No fuerces módulos que no tengan relación con el proyecto.
- Deduce las pantallas más relevantes según descripción, objetivo, requisitos y normas empresariales.
- Prioriza estructura, layout, jerarquía de información y flujo de usuario.
- Evita sobrecargar cada escena con demasiados widgets, KPIs o formularios.
- En "Escenas principales sugeridas" incluye para cada escena: nombre, objetivo y acciones principales.
- En "Contenido clave por escena" indica los bloques o datos que deberia tener cada pantalla.
- En "Flujo recomendado entre escenas" explica como se conectan las pantallas principales.
- Si falta contexto, completa con supuestos razonables, pero sin inventar integraciones muy específicas.

Reglas específicas para "Wireframe prompt listo para pegar":
- Debe parecerse estructuralmente a un prompt de multi-screen low-fidelity wireframe set.
- Debe pedir varias escenas principales sencillas, no una sola pantalla compleja.
- Debe mencionar explicitamente el nombre real del proyecto.
- Debe incorporar el contexto del proyecto y adaptar las pantallas al dominio detectado.
- Debe pedir low-fidelity wireframes, grayscale, sketch-style or rough SaaS wireframe.
- Debe pedir simple boxes, placeholders, labels y una composicion clara.
- Debe indicar que solo incluya las opciones más relevantes para luego seguir editando.
- Debe cerrar con un goal similar a: continue refining the product structure and make UI adjustments later.

Responde solo con Markdown.`;

    return runAiAction(userId, payload.projectId, () =>
      withAiFallback(
        async () => (await requestGeminiCompletion(prompt)).trim(),
        async () => (await requestGroqCompletion(prompt)).trim(),
      ),
    );
  },

  async generateDeliveryUnitSummary(
    userId: number,
    payload: { projectId: string; input: DeliveryUnitSummaryInput },
  ) {
    const input = payload.input;

    const prompt = `Actua como redactora ejecutiva para reportes QA.
Tu tarea es redactar un resumen breve y profesional de una unidad de entrega.

Reglas obligatorias:
- Usa EXCLUSIVAMENTE la informacion proporcionada abajo.
- No inventes porcentajes, riesgos, fechas, actividades, funcionalidades, bugs ni cobertura.
- No uses informacion del proyecto completo ni de otras unidades.
- Si falta informacion, escribe texto conservador y breve.
- Devuelve solo JSON valido.

Unidad de entrega:
${JSON.stringify(input.deliveryUnit, null, 2)}

Actividades registradas:
${JSON.stringify(input.activities, null, 2)}

Funcionalidades asociadas:
${JSON.stringify(input.functionalities, null, 2)}

Metricas reales:
${JSON.stringify(input.metrics || {}, null, 2)}

Necesito:
1. introduction: un parrafo corto, profesional y claro
2. objectives: texto corto en lineas tipo bullet, derivado solo de la unidad, actividades y funcionalidades
3. conclusion: un parrafo corto sobre avance general y preparacion de la siguiente etapa, sin inventar resultados

Responde solo con JSON valido usando este formato:
{
  "introduction": "",
  "objectives": "",
  "conclusion": ""
}`;

    return runAiAction(userId, payload.projectId, () =>
      withAiFallback(
        async () => {
          const text = await requestGeminiCompletion(prompt, 'application/json');
          const result = extractJsonPayload<{
            introduction?: unknown;
            objectives?: unknown;
            conclusion?: unknown;
          }>(text);

          return {
            introduction: normalizeAiText(result?.introduction),
            objectives: normalizeAiText(result?.objectives),
            conclusion: normalizeAiText(result?.conclusion),
          };
        },
        async () => {
          const result = extractJsonPayload<{
            introduction?: unknown;
            objectives?: unknown;
            conclusion?: unknown;
          }>(
            await requestGroqCompletion(`${prompt}\n\nResponde unicamente con JSON valido.`),
          );

          return {
            introduction: normalizeAiText(result?.introduction),
            objectives: normalizeAiText(result?.objectives),
            conclusion: normalizeAiText(result?.conclusion),
          };
        },
      ),
    );
  },

  async analyzeTechnicalReport(
    userId: number,
    payload: { projectId: string; input: TechnicalReportAnalysisInput },
  ) {
    const prompt = buildTechnicalReportPrompt(payload.input);

    return runAiAction(userId, payload.projectId, () =>
      withAiFallback(
        async () => (await requestGeminiCompletion(prompt)).trim(),
        async () => (await requestGroqCompletion(prompt)).trim(),
      ),
    );
  },
});

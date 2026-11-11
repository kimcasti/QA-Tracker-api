import test from 'node:test';
import assert from 'node:assert/strict';

test('brief validates project context and ignores obsolete approval fields', async () => {
  const module = await import('./wireframe-prompt');
  assert.equal(typeof module.normalizeWireframeBriefInput, 'function');
  for (const value of [null, [], {name:''}, {name:7}, {name:'x',coreRequirements:'yes'}, {name:'x',coreRequirements:[7]}, {name:'x',coreRequirements:[' ']}, {name:'x',businessRules:'x'.repeat(12001)}, {name:'x',coreRequirements:['x'.repeat(1001)]}]) {
    assert.throws(() => module.normalizeWireframeBriefInput(value), /Invalid wireframe/);
  }
  assert.deepEqual(module.normalizeWireframeBriefInput({name:' x ',confirmedConclusions:['obsolete'],aiProjectInsights:'client analysis'}), {name:'x',coreRequirements:[]});
});

test('project information is primary and optional analysis is support, without manual approval', async () => {
  const module = await import('./wireframe-prompt').catch(() => null);
  assert.ok(module?.buildWireframeBriefPrompt, 'brief prompt builder must exist');
  const prompt = module.buildWireframeBriefPrompt({ name: 'Reserva', purpose:'Gestionar reservas', coreRequirements:['Buscar disponibilidad'], businessRules:'Sin solapamientos' }, 'Análisis persistido de apoyo');
  assert.match(prompt, /FUENTE PRINCIPAL[\s\S]*Buscar disponibilidad[\s\S]*Sin solapamientos/);
  assert.match(prompt, /ANÁLISIS DE APOYO[\s\S]*Análisis persistido de apoyo/);
  assert.doesNotMatch(prompt, /CONCLUSIONES CONFIRMADAS|persona revisora|rough SaaS/);
  assert.match(prompt, /## Supuestos y preguntas pendientes/);
  assert.match(prompt, /LOFI OBLIGATORIO/);
  assert.match(prompt, /no colors, no gradients, no photography/);
  assert.match(module.buildWireframeBriefPrompt({name:'Reserva'}), /No hay análisis previo/);
});


test('brief and direct generation share concrete domain-adapted UX and lo-fi standards',async()=>{
 const module=await import('./wireframe-prompt');
 assert.equal(typeof module.buildStitchFlowPrompt,'function');
 for(const prompt of [module.buildWireframeBriefPrompt({name:'Reservas'}),module.buildStitchFlowPrompt('Brief de reservas')]) {
  for(const phrase of ['actor','entrada','tarea principal','resultado','acción primaria','etiquetas persistentes','validación inline','resumen de errores','sin pérdida de datos','foco visible','teclado','contraste','divulgación progresiva','revisión','irreversible','vacío','cargando','error','éxito','sin patrones oscuros','navegación consistente','supuestos','LOFI OBLIGATORIO'])assert.ok(prompt.includes(phrase),phrase);
 }
 const direct=module.buildStitchFlowPrompt('Brief de reservas');
 assert.match(direct,/ONE.*end-to-end/);assert.match(direct,/2.*12/);assert.match(direct,/4.*7/);assert.doesNotMatch(direct,/exactly ONE desktop screen/);
});

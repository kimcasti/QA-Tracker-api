import test from 'node:test';
import assert from 'node:assert/strict';

test('brief rejects malformed or unbounded reviewed input instead of coercing approval', async () => {
  const module = await import('./wireframe-prompt');
  assert.equal(typeof module.normalizeWireframeBriefInput, 'function');
  for (const value of [null, [], {name:''}, {name:7}, {name:'x',confirmedConclusions:'yes'}, {name:'x',confirmedConclusions:[7]}, {name:'x',confirmedConclusions:[' ']}, {name:'x',confirmedConclusions:Array(21).fill('x')}, {name:'x',aiProjectInsights:'x'.repeat(20001)}, {name:'x',coreRequirements:['x'.repeat(1001)]}]) {
    assert.throws(() => module.normalizeWireframeBriefInput(value), /Invalid wireframe/);
  }
  assert.deepEqual(module.normalizeWireframeBriefInput({name:' x ',confirmedConclusions:[' reviewed ']}), {name:'x',confirmedConclusions:['reviewed'],coreRequirements:[]});
});

test('brief separates explicitly reviewed conclusions from unconfirmed analysis and mandates lo-fi', async () => {
  const module = await import('./wireframe-prompt').catch(() => null);
  assert.ok(module?.buildWireframeBriefPrompt, 'brief prompt builder must exist');
  const prompt = module.buildWireframeBriefPrompt({ name: 'Reserva', confirmedConclusions: ['La reserva necesita aprobación'], aiProjectInsights: 'Quizá pagos' }, 'Análisis persistido no revisado');
  assert.match(prompt, /CONFIRMADAS[\s\S]*La reserva necesita aprobación/);
  assert.match(prompt, /NO CONFIRMADO[\s\S]*Análisis persistido no revisado/);
  assert.doesNotMatch(prompt, /Quizá pagos|rough SaaS/);
  assert.match(prompt, /## Supuestos y preguntas pendientes/);
  assert.match(prompt, /LOFI OBLIGATORIO/);
  assert.match(prompt, /no colors, no gradients, no photography/);
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

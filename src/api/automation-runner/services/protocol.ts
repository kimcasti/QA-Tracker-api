import { createHash } from 'node:crypto';
import { errors } from '@strapi/utils';

export const LEASE_MS = 90_000;
export const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const fail = (message: string): never => { throw new errors.ValidationError(message); };
export function positiveId(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) fail('Identificador numérico inválido.');
  return value as number;
}
export function requiredString(value: unknown, name: string, max = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(name + ' inválido.');
  return value as string;
}
export function catalogInput(value: unknown): string[] {
  if (!Array.isArray(value) || !value.length || value.length > 5000) fail('Catálogo inválido.');
  return (value as unknown[]).map(item => {
    const ref = requiredString(item, 'Referencia', 1000);
    if (!ref.includes('::') || /[\r\n\0]/.test(ref)) fail('Referencia inválida.');
    return ref;
  }).sort();
}
export function referenceProblem(reference: string, catalog: string[], projectReferences: string[]) {
  if (!reference) return 'Falta la referencia';
  const count = catalog.filter(ref => ref === reference).length;
  if (!count) return 'No existe en el ejecutor';
  if (count !== 1) return 'Referencia ambigua en el ejecutor';
  if (projectReferences.filter(ref => ref === reference).length !== 1) return 'Referencia duplicada en QA Tracker';
  return null;
}
export interface SelectedCase { resultId: string; caseId: string; reference: string; title: string }
export interface Outcome { automationReference: string; status: 'passed' | 'failed' | 'skipped' | 'unknown'; notes?: string; evidenceImage?: string }
export function validateOutcomes(value: unknown, cases: SelectedCase[]): Outcome[] {
  if (!Array.isArray(value) || value.length !== cases.length) fail('Los resultados deben corresponder exactamente a la selección.');
  const seen = new Set<string>();
  return (value as Outcome[]).map(item => {
    if (!item || !cases.some(c => c.reference === item.automationReference) || seen.has(item.automationReference)) fail('Resultado ajeno o duplicado.');
    seen.add(item.automationReference);
    if (!['passed', 'failed', 'skipped', 'unknown'].includes(item.status)) fail('Estado de test inválido.');
    if (item.notes != null && (typeof item.notes !== 'string' || item.notes.length > 20000)) fail('Notas inválidas.');
    if (item.evidenceImage != null && (typeof item.evidenceImage !== 'string' || item.evidenceImage.length > 1500000 ||
      !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(item.evidenceImage))) fail('Captura inválida.');
    return { automationReference: item.automationReference, status: item.status, notes: item.notes || '', evidenceImage: item.evidenceImage || null };
  }).sort((a, b) => a.automationReference.localeCompare(b.automationReference));
}

// Use a parser, never a regex-only sanitizer. This is also applied to persisted notes on read.
import sanitizeHtml from 'sanitize-html';

export const CANVAS_COLORS = ['default', 'blue', 'green', 'yellow', 'orange', 'violet', 'pink'] as const;
export type CanvasColor = typeof CANVAS_COLORS[number];
export type CanvasState = {
  version: 1;
  nodes: Record<string, { x: number; y: number; color?: CanvasColor; expanded?: boolean }>;
  notes: Array<{ id: string; html: string; anchorId?: string }>;
  newElementColor: CanvasColor;
};

export function sanitizeCanvasHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ['p', 'div', 'br', 'b', 'strong', 'i', 'em', 'ul', 'ol', 'li', 'a'],
    allowedAttributes: { a: ['href', 'target', 'rel'] },
    allowedSchemes: ['http', 'https'],
    allowProtocolRelative: false,
    transformTags: {
      a: (_tag, attributes) => {
        const attribs: Record<string, string> = {};
        try {
          const url = new URL(attributes.href);
          if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) {
            attribs.href = url.href;
            if (attributes.target === '_blank') {
              attribs.target = '_blank';
              attribs.rel = 'noopener noreferrer';
            }
          }
        } catch { /* Invalid, relative and credential-bearing links become plain text. */ }
        return { tagName: 'a', attribs };
      },
    },
  });
}

import { errors } from '@strapi/utils';

export const CANVAS_LIMITS = { bytes: 262144, nodes: 1000, notes: 200, html: 20000, coordinate: 100000 } as const;
const identifier = /^[A-Za-z0-9_-]{1,128}$/;
const reference = /^(module|functionality|case):[A-Za-z0-9_-]{1,128}$/;
const bad = () => { throw new errors.ValidationError('Invalid Canvas state.'); };
function object(value: any, allowed?: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) bad();
  if (Object.keys(value).some(key => ['__proto__','constructor','prototype'].includes(key) || (allowed && !allowed.includes(key)))) bad();
}
export function normalizeCanvasState(value: any): CanvasState {
  object(value, ['version', 'nodes', 'notes', 'newElementColor']);
  let bytes: number;
  try { bytes = Buffer.byteLength(JSON.stringify(value), 'utf8'); } catch { bad(); }
  if (bytes! > CANVAS_LIMITS.bytes || value.version !== 1 || !CANVAS_COLORS.includes(value.newElementColor)) bad();
  object(value.nodes);
  if (Object.keys(value.nodes).length > CANVAS_LIMITS.nodes || !Array.isArray(value.notes) || value.notes.length > CANVAS_LIMITS.notes) bad();
  const ids = new Set<string>();
  const notes = value.notes.map(note => {
    object(note, ['id', 'html', 'anchorId']);
    if (typeof note.id !== 'string' || !identifier.test(note.id) || ids.has(note.id) ||
        typeof note.html !== 'string' || Buffer.byteLength(note.html, 'utf8') > CANVAS_LIMITS.html ||
        ('anchorId' in note && (typeof note.anchorId !== 'string' || !reference.test(note.anchorId)))) bad();
    ids.add(note.id);
    return { id: note.id, html: sanitizeCanvasHtml(note.html), ...('anchorId' in note ? { anchorId: note.anchorId } : {}) };
  });
  const nodes: CanvasState['nodes'] = {};
  for (const [key, raw] of Object.entries(value.nodes)) {
    const node = raw as any;
    object(node, ['x', 'y', 'color', 'expanded']);
    if ((!/^(module|functionality):[A-Za-z0-9_-]{1,128}$/.test(key) &&
         !(key.startsWith('note:') && ids.has(key.slice(5)))) ||
        ![node.x,node.y].every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= CANVAS_LIMITS.coordinate) ||
        ('color' in node && !CANVAS_COLORS.includes(node.color)) ||
        ('expanded' in node && typeof node.expanded !== 'boolean')) bad();
    nodes[key] = { x: node.x, y: node.y, ...('color' in node ? {color: node.color}:{}), ...('expanded' in node ? {expanded:node.expanded}:{}) };
  }
  return { version: 1, nodes, notes, newElementColor: value.newElementColor };
}

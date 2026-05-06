export function normalizeGeminiError(error: unknown): never {
  const raw: any = (error as any)?.error ?? error;
  const reason = raw?.details?.[0]?.reason;
  const message = (raw?.message || raw?.error?.message || (error as any)?.message || '').toString();

  if (reason === 'API_KEY_INVALID' || /api key not valid/i.test(message)) {
    throw new Error('GEMINI_API_KEY_INVALID');
  }

  if (/reported as leaked/i.test(message)) {
    throw new Error('GEMINI_API_KEY_LEAKED');
  }

  throw error instanceof Error ? error : new Error(message || 'AI_PROVIDER_ERROR');
}

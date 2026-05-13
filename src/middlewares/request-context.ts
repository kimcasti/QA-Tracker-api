import crypto from 'node:crypto';

type HeaderValue = string | string[] | undefined;

function getHeaderValue(value: HeaderValue) {
  if (Array.isArray(value)) {
    return value[0] || '';
  }

  return value || '';
}

export default () => {
  return async (ctx, next) => {
    const startedAt = Date.now();
    const requestId = getHeaderValue(ctx.request.headers['x-request-id']) || crypto.randomUUID();

    ctx.state.requestId = requestId;
    ctx.set('x-request-id', requestId);

    try {
      await next();
    } catch (error) {
      strapi.log.error(
        `[request:${requestId}] ${ctx.method} ${ctx.url} failed with status ${ctx.status || 500}`,
        error,
      );
      throw error;
    } finally {
      const durationMs = Date.now() - startedAt;
      const statusCode = ctx.status || 404;

      if (statusCode >= 500) {
        strapi.log.error(
          `[request:${requestId}] ${ctx.method} ${ctx.url} -> ${statusCode} (${durationMs}ms)`,
        );
      } else if (statusCode >= 400) {
        strapi.log.warn(
          `[request:${requestId}] ${ctx.method} ${ctx.url} -> ${statusCode} (${durationMs}ms)`,
        );
      } else {
        strapi.log.info(
          `[request:${requestId}] ${ctx.method} ${ctx.url} -> ${statusCode} (${durationMs}ms)`,
        );
      }
    }
  };
};

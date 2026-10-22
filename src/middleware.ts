import { defineMiddleware } from 'astro:middleware';
import { allowLocalAccess } from './server/auth/local-access.ts';

export const onRequest = defineMiddleware(async (context, next) => {
  const env = context.locals.runtime?.env;
  if (!env || !allowLocalAccess(context.url, env)) {
    return new Response('Hosted collection access is not enabled in Stage 1.', {
      status: 503, headers: { 'Cache-Control': 'private, no-store' },
    });
  }
  const response = await next();
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  return response;
});

import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger as honoLogger } from "hono/logger";
import { hasProviderKey, PROVIDER_KEYS } from "./env";
import vibeRouter from "./routers/vibe"; // imports vibe-coder, which loads env on import
import { logger } from "./logger";

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';
const NODE_ENV = process.env.NODE_ENV || 'development';

if (!hasProviderKey()) {
  // Not fatal: the UI still loads and the provider throws a clear error on the
  // first model call. The `vibes` CLI onboards the user before reaching here.
  logger.warn(
    `No model-provider key set (${PROVIDER_KEYS.join(', ')}). ` +
    `Run \`vibes login\` (or set the key in the environment) before sending a message.`,
  );
}

const app = new Hono();

app.use('/api/*', async (c, next) => {
  if (c.req.method === 'POST') {
    try {
      const body = await c.req.raw.clone().json();
      logger.info({ body, path: c.req.path }, 'Incoming POST request');
    } catch (e) {
      // Not JSON or other error
    }
  }
  await next();
});

app.use('/*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

if (NODE_ENV === 'production') {
  app.use('/*', honoLogger());
}

app.onError((err, c) => {
  logger.error({ error: err.message }, 'Error occurred');

  const isDev = NODE_ENV === 'development';

  return c.json(
    {
      success: false,
      error: 'Internal server error',
      details: isDev ? err.message : undefined,
    },
    500
  );
});

app.get('/api/health', (c) => {
  return c.json({
    status: 'ok',
    environment: NODE_ENV,
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/', (c) => {
  return c.json({
    message: 'Vibes API',
    version: '1.0.0',
    environment: NODE_ENV,
  });
});

app.route('/api', vibeRouter);

Bun.serve({
  fetch: app.fetch,
  port: PORT,
  hostname: HOST,
  error: (err) => {
    logger.error({ error: err.message }, 'Error occurred');
    return new Response(JSON.stringify({
      success: false,
      error: 'Internal server error',
      details: NODE_ENV === 'development' ? err.message : undefined,
    }), { status: 500 });
  },
  idleTimeout: 0,
});

logger.info(
  { host: HOST, port: PORT, environment: NODE_ENV },
  `🦊 Vibes API is running on http://${HOST}:${PORT}`
);

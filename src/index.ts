import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger as honoLogger } from "hono/logger";
import agentRouter from "./routers/agent";
import viperRouter from "./routers/viper";
import mimoCodeRouter from "./routers/mimo-code";
import 'dotenv/config';
import { logger } from "./logger";

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';
const NODE_ENV = process.env.NODE_ENV || 'development';

if (NODE_ENV === 'production' && !process.env.OPENAI_API_KEY) {
  logger.error('OPENAI_API_KEY is required in production');
  throw new Error('OPENAI_API_KEY is required in production');
}

const app = new Hono();

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

app.route('/api', agentRouter);
app.route('/api', viperRouter);
app.route('/api', mimoCodeRouter);

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

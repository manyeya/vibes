import pino from 'pino';

const NODE_ENV = process.env.NODE_ENV || 'development';

export const logger = pino({
  level: NODE_ENV === 'production' ? 'info' : 'debug',
  transport: NODE_ENV === 'development' ? {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'HH:MM:ss Z',
      ignore: 'pid,hostname',
    },
  } : undefined,
});

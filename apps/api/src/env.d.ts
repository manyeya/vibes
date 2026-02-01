// src/env.d.ts
declare global {
  namespace NodeJS {
    interface ProcessEnv {
      PORT: string
      OPENROUTER_API_KEY: string
    }
  }
}
export {}
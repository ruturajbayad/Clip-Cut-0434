import { Hono } from 'hono';
import { cors } from "hono/cors"

const app = new Hono()
  .basePath('api')
  .use(cors({ origin: (origin) => origin ?? "*", credentials: true }))
  .get('/ping', (c) => c.json({ message: `Pong! ${Date.now()}` }))
  .get('/health', (c) => c.json({ status: 'ok' }));

export type AppType = typeof app;
export default app;
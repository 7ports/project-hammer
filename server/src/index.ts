console.log(`[boot] index.ts start ${new Date().toISOString()} pid=${process.pid} node=${process.version}`);

import express from 'express';
import cors from 'cors';
import * as path from 'path';
import { config } from './lib/config';
import { aisProxy } from './lib/aisProxy';
import { ferryStatusMonitor } from './lib/ferryStatusMonitor';
import { attachIngest, getDb, initStorage } from './lib/storage';
import { healthRouter } from './routes/health';
import { aisRouter } from './routes/ais';
import { weatherRouter } from './routes/weather';
import ferryStatusRouter from './routes/ferryStatus';
import busynessRouter from './routes/busyness';
import { aisStatusRouter } from './routes/aisStatus';
import analyticsRouter from './routes/analytics';
import llmRouter from './routes/llm';

console.log('[boot] imports loaded');

const app = express();

app.use(cors({ origin: config.corsOrigin }));
app.use(express.json());

console.log('[boot] mounting routes');
app.use('/api/health', healthRouter);
app.use('/api/ais', aisRouter);
app.use('/api/weather', weatherRouter);
app.use('/api/ferry-status', ferryStatusRouter);
app.use('/api/ferry-busyness', busynessRouter);
app.use('/api/ais/status', aisStatusRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/llm', llmRouter);
console.log('[boot] routes mounted');

export default app;

// Only start listening when this module is run directly (not imported by tests)
if (require.main === module) {
  // Surface any silent crash so Fly's log stream shows *something* — without
  // these, an uncaught throw during boot exits with no message and Fly just
  // reports "health check timeout" with no signal as to why.
  process.on('uncaughtException', (err) => {
    console.error('[fatal] uncaughtException:', err);
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    console.error('[fatal] unhandledRejection:', reason);
  });
  console.log(`[boot] node=${process.version} pid=${process.pid} port=${config.port}`);

  // Storage init runs BEFORE subscribers attach so the writer wiring can
  // rely on getDb() being available. A failure here must NOT crash the
  // SSE relay — log loudly and continue (see ais-storage.md §7.4).
  let storageReady = false;
  console.log(`[boot] initStorage start path=${config.storageDbPath}`);
  try {
    const { dbPath, migration } = initStorage(config.storageDbPath);
    storageReady = true;
    console.log(
      `[storage] initialised db=${dbPath} schema_version=${migration.from}->${migration.to}`,
    );
    console.log('[boot] initStorage done');
  } catch (err) {
    console.error('[boot] initStorage FAILED:', err);
    console.error('[storage] init failed — continuing without persistence:', err);
  }

  // Wire ingest subscribers BEFORE starting the providers/monitor so we
  // don't miss the first batch of positions / events emitted on startup.
  if (storageReady) {
    try {
      // public/schedule.json lives at the repo root, two levels up from
      // both src/ (tsx dev mode) and dist/ (production build).
      const schedulePath = path.resolve(__dirname, '..', '..', 'public', 'schedule.json');
      attachIngest({
        db: getDb(),
        providerManager: aisProxy,
        ferryStatusMonitor,
        schedulePath,
      });
      console.log('[storage] ingest attached (positions, ferry events, provider state, schedule)');
    } catch (err) {
      console.error('[storage] attachIngest failed — continuing without persistence:', err);
    }
  }

  console.log('[boot] providerManager start');
  aisProxy.connect();
  console.log('[boot] ferryStatusMonitor start');
  ferryStatusMonitor.start();

  app.listen(config.port, () => {
    console.log(`[boot] listening on port ${config.port}`);
    console.log(`Server listening on port ${config.port}`);
  });
}

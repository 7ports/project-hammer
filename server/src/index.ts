import express from 'express';
import cors from 'cors';
import { config } from './lib/config';
import { aisProxy } from './lib/aisProxy';
import { ferryStatusMonitor } from './lib/ferryStatusMonitor';
import { initStorage } from './lib/storage';
import { healthRouter } from './routes/health';
import { aisRouter } from './routes/ais';
import { weatherRouter } from './routes/weather';
import ferryStatusRouter from './routes/ferryStatus';
import busynessRouter from './routes/busyness';
import { aisStatusRouter } from './routes/aisStatus';

const app = express();

app.use(cors({ origin: config.corsOrigin }));
app.use(express.json());

app.use('/api/health', healthRouter);
app.use('/api/ais', aisRouter);
app.use('/api/weather', weatherRouter);
app.use('/api/ferry-status', ferryStatusRouter);
app.use('/api/ferry-busyness', busynessRouter);
app.use('/api/ais/status', aisStatusRouter);

export default app;

// Only start listening when this module is run directly (not imported by tests)
if (require.main === module) {
  // Storage init runs BEFORE subscribers attach so Task 5's writer wiring
  // can rely on getDb() being available. A failure here must NOT crash the
  // SSE relay — log loudly and continue (see ais-storage.md §7.4).
  try {
    const { dbPath, migration } = initStorage(config.storageDbPath);
    console.log(
      `[storage] initialised db=${dbPath} schema_version=${migration.from}->${migration.to}`,
    );
  } catch (err) {
    console.error('[storage] init failed — continuing without persistence:', err);
  }

  aisProxy.connect();
  ferryStatusMonitor.start();

  app.listen(config.port, () => {
    console.log(`Server listening on port ${config.port}`);
  });
}

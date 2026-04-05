import express from 'express';
import cors from 'cors';
import { config } from './lib/config';
import { aisProxy } from './lib/aisProxy';
import { healthRouter } from './routes/health';
import { aisRouter } from './routes/ais';
import { weatherRouter } from './routes/weather';

const app = express();

app.use(cors({ origin: config.corsOrigin }));
app.use(express.json());

app.use('/api/health', healthRouter);
app.use('/api/ais', aisRouter);
app.use('/api/weather', weatherRouter);

export default app;

// Only start listening when this module is run directly (not imported by tests)
if (require.main === module) {
  aisProxy.connect();

  app.listen(config.port, () => {
    console.log(`Server listening on port ${config.port}`);
  });
}

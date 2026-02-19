import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import connectDB from './config/database.js';
import createApp from './app.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

process.on('unhandledRejection', (reason) => {
  console.error('❌ Unhandled promise rejection:', reason);
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught exception:', err);
  process.exit(1);
});

const DEFAULT_PORT = 8001;
const HOST = process.env.HOST || '0.0.0.0';
const isPortExplicit = typeof process.env.PORT === 'string' && process.env.PORT.trim().length > 0;
const initialPort = Number(isPortExplicit ? process.env.PORT : DEFAULT_PORT);

if (!Number.isFinite(initialPort) || initialPort <= 0) {
  throw new Error(`Invalid PORT value: ${process.env.PORT}`);
}

try {
  await connectDB();
} catch (err) {
  console.error('❌ Failed to connect to MongoDB.');
  console.error(err);
  console.error(
    'ℹ️  On Render, set MONGO_URL and DB_NAME in the service Environment settings (or set USE_IN_MEMORY_DB=true for a temporary in-memory DB).'
  );
  process.exit(1);
}

const app = createApp();

const MAX_PORT_TRIES = 10;
let tryCount = 0;

const startServer = (port) => {
  tryCount += 1;
  const server = app.listen(port, HOST, () => {
    console.log(`✅ Server running on http://${HOST}:${port}`);
  });

  server.on('error', (err) => {
    if (err?.code === 'EADDRINUSE') {
      if (isPortExplicit) {
        console.error(`❌ Port ${port} is already in use. Stop the other process or change PORT in backend/.env`);
        process.exit(1);
      }

      if (tryCount >= MAX_PORT_TRIES) {
        console.error(`❌ Could not find a free port starting at ${initialPort} after ${MAX_PORT_TRIES} attempts.`);
        console.error('Set PORT in backend/.env (or stop the process currently using the port).');
        process.exit(1);
      }

      const nextPort = port + 1;
      console.warn(`⚠️  Port ${port} is in use; trying ${nextPort}...`);
      setTimeout(() => startServer(nextPort), 250);
      return;
    }

    console.error('❌ Server failed to start:', err);
    process.exit(1);
  });
};

startServer(initialPort);
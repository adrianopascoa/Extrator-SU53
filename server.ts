import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;

async function startServer() {
  const app = express();

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
  });

  // Serve worker, core WASM e modelo eng do Tesseract + worker PDF.js localmente (mesma origem, 100% offline/intranet)
  const tesseractWorkerDir = path.resolve(__dirname, 'node_modules/tesseract.js/dist');
  const tesseractCoreDir = path.resolve(__dirname, 'node_modules/tesseract.js-core');
  const tesseractLangDir = path.resolve(__dirname, 'node_modules/@tesseract.js-data/eng/4.0.0');
  const pdfjsBuildDir = path.resolve(__dirname, 'node_modules/pdfjs-dist/build');

  if (fs.existsSync(tesseractWorkerDir)) {
    app.use('/tesseract/worker', express.static(tesseractWorkerDir, { maxAge: '7d' }));
  }
  if (fs.existsSync(tesseractCoreDir)) {
    app.use('/tesseract/core', express.static(tesseractCoreDir, { maxAge: '7d' }));
  }
  if (fs.existsSync(tesseractLangDir)) {
    app.use('/tesseract/lang', express.static(tesseractLangDir, { maxAge: '7d' }));
  }
  if (fs.existsSync(pdfjsBuildDir)) {
    app.use('/pdfjs', express.static(pdfjsBuildDir, { maxAge: '7d' }));
  }

  const isRunningTsx =
    process.execArgv.some((arg) => arg.includes('tsx')) ||
    process.argv.some((arg) => arg.includes('tsx')) ||
    process.env.npm_lifecycle_event === 'dev';
  const distPath = path.resolve(__dirname, 'dist');
  const hasDistBuild = fs.existsSync(path.join(distPath, 'index.html'));
  const useProductionStatic =
    process.env.NODE_ENV === 'production' || (!isRunningTsx && hasDistBuild);

  if (!useProductionStatic) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      const indexFile = path.join(distPath, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build not found. Run npm run build first.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Extrator SAP SU53 server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();

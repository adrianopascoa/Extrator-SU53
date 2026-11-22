import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      // Copies src/assets into dist/ so root-relative URLs like
      // "/src/assets/images/..." (e.g. generate_image output) still resolve
      // in production builds. Do not remove.
      {
        name: 'copy-unbundled-src-assets',
        apply: 'build',
        closeBundle(error?: Error): void {
          if (error) {
            return;
          }
          const distDir = path.resolve(__dirname, 'dist');
          if (!fs.existsSync(distDir)) {
            return;
          }

          const srcAssets = path.resolve(__dirname, 'src/assets');
          const distAssets = path.resolve(distDir, 'src/assets');
          if (fs.existsSync(srcAssets)) {
            fs.cpSync(srcAssets, distAssets, {recursive: true, force: true});
          }

          const staticRuntimeMounts: Array<{
            src: string;
            dest: string;
            filter: (filePath: string) => boolean;
          }> = [
            {
              src: path.resolve(__dirname, 'node_modules/tesseract.js/dist'),
              dest: path.resolve(distDir, 'tesseract/worker'),
              filter: (filePath) =>
                fs.statSync(filePath).isDirectory() ||
                path.basename(filePath) === 'worker.min.js' ||
                path.basename(filePath) === 'worker.min.js.LICENSE.txt',
            },
            {
              src: path.resolve(__dirname, 'node_modules/tesseract.js-core'),
              dest: path.resolve(distDir, 'tesseract/core'),
              filter: (filePath) =>
                fs.statSync(filePath).isDirectory() ||
                /^tesseract-core.*\.(js|wasm)$/.test(path.basename(filePath)),
            },
            {
              src: path.resolve(__dirname, 'node_modules/@tesseract.js-data/eng/4.0.0'),
              dest: path.resolve(distDir, 'tesseract/lang'),
              filter: (filePath) =>
                fs.statSync(filePath).isDirectory() ||
                filePath.endsWith('.traineddata.gz'),
            },
            {
              src: path.resolve(__dirname, 'node_modules/pdfjs-dist/build'),
              dest: path.resolve(distDir, 'pdfjs'),
              filter: (filePath) =>
                fs.statSync(filePath).isDirectory() ||
                filePath.endsWith('.min.mjs'),
            },
          ];

          for (const mount of staticRuntimeMounts) {
            if (fs.existsSync(mount.src)) {
              fs.cpSync(mount.src, mount.dest, {
                recursive: true,
                force: true,
                filter: mount.filter,
              });
            }
          }
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});

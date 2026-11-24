import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';

const ROOT_DIR = import.meta.dirname;

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: [
          'apple-touch-icon.png',
          'assets/aistudio/SAP_Logo_-_Colored_-_32x32_3644d71f.png',
        ],
        manifest: {
          id: '/',
          name: 'Extrator SU53',
          short_name: 'SU53',
          description:
            'Consolidador inteligente de logs de autorização SU53 em lote com processamento 100% local no navegador.',
          theme_color: '#0070f2',
          background_color: '#f8fafc',
          display: 'standalone',
          start_url: '/',
          scope: '/',
          lang: 'pt-BR',
          icons: [
            {
              src: '/pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
          globIgnores: ['tesseract/**', 'pdfjs/**'],
          navigateFallback: '/index.html',
          runtimeCaching: [
            {
              urlPattern: /^\/tesseract\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'su53-ocr-assets',
                expiration: {
                  maxEntries: 16,
                  maxAgeSeconds: 60 * 60 * 24 * 30,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^\/pdfjs\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'su53-pdfjs-assets',
                expiration: {
                  maxEntries: 8,
                  maxAgeSeconds: 60 * 60 * 24 * 30,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
          ],
        },
        devOptions: {
          enabled: true,
          type: 'module',
        },
      }),
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
          const distDir = path.resolve(ROOT_DIR, 'dist');
          if (!fs.existsSync(distDir)) {
            return;
          }

          const srcAssets = path.resolve(ROOT_DIR, 'src/assets');
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
              src: path.resolve(ROOT_DIR, 'node_modules/tesseract.js/dist'),
              dest: path.resolve(distDir, 'tesseract/worker'),
              filter: (filePath) =>
                fs.statSync(filePath).isDirectory() ||
                path.basename(filePath) === 'worker.min.js' ||
                path.basename(filePath) === 'worker.min.js.LICENSE.txt',
            },
            {
              src: path.resolve(ROOT_DIR, 'node_modules/tesseract.js-core'),
              dest: path.resolve(distDir, 'tesseract/core'),
              filter: (filePath) =>
                fs.statSync(filePath).isDirectory() ||
                /^tesseract-core(?:-(?:relaxed)?simd)?-lstm\.wasm\.js$/.test(
                  path.basename(filePath)
                ),
            },
            {
              src: path.resolve(ROOT_DIR, 'node_modules/@tesseract.js-data/eng/4.0.0'),
              dest: path.resolve(distDir, 'tesseract/lang'),
              filter: (filePath) =>
                fs.statSync(filePath).isDirectory() ||
                filePath.endsWith('.traineddata.gz'),
            },
            {
              src: path.resolve(ROOT_DIR, 'node_modules/pdfjs-dist/build'),
              dest: path.resolve(distDir, 'pdfjs'),
              filter: (filePath) =>
                fs.statSync(filePath).isDirectory() ||
                path.basename(filePath) === 'pdf.worker.min.mjs',
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
        '@': path.resolve(ROOT_DIR, '.'),
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

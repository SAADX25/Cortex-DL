import { defineConfig } from 'vite'
import path from 'node:path'
import fs from 'node:fs'
import electron from 'vite-plugin-electron/simple'
import react from '@vitejs/plugin-react'

const buildInfo = fs.existsSync(path.join(__dirname, 'build-manifest.json')) ? JSON.parse(fs.readFileSync(path.join(__dirname, 'build-manifest.json'), 'utf8')) : { commit: 'development' }
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf-8'))


export default defineConfig(({ command }) => {

  return {
    root: path.join(__dirname, 'Front-End'),
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      __BUILD_SHA__: JSON.stringify(buildInfo.commit),
    },
    build: {
      sourcemap: false,
      minify: 'esbuild' as const
    },
    plugins: [
      react(),
      electron({
        main: {
          onstart({ startup }) {
            const directory = process.env.CORTEX_STARTUP_PROBE_DIR
            void startup(directory ? ['.', '--startup-probe', '--smoke-offline', '--smoke-dir=' + directory] : undefined)
          },
          entry: path.join(__dirname, 'Back-End', 'electron', 'entrypoint.ts'),
          vite: {
            build: {
              outDir: path.join(__dirname, 'dist-electron'),
              // Clear stale chunks for packaging; preserve preload during dev watch rebuilds.
              emptyOutDir: command === 'build',
              rollupOptions: {
                output: { entryFileNames: 'main.js' },
                external: ['better-sqlite3']
              }
            }
          }
        },
        preload: {
          input: path.join(__dirname, 'Back-End', 'electron', 'preload.ts'),
          vite: {
            build: {
              outDir: path.join(__dirname, 'dist-electron'),
              // Main and preload share this directory; retain the freshly built main chunks.
              emptyOutDir: false,
              rollupOptions: {
                external: ['better-sqlite3']
              }
            }
          }
        },
      }),
    ],
  }
})

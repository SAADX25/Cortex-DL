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
      minify: 'esbuild' as const,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return
            if (id.includes('hls.js')) return 'hls-vendor'
            if (id.includes('framer-motion')) return 'motion-vendor'
            if (id.includes('lucide-react')) return 'icons-vendor'
            if (/node_modules[\\/](?:react|react-dom|scheduler)[\\/]/.test(id)) {
              return 'react-vendor'
            }
          },
        },
      },
    },
    plugins: [
      react(),
      electron({
        main: {
          entry: path.join(__dirname, 'Back-End', 'electron', 'bootstrap.ts'),
          vite: {
            build: {
              outDir: path.join(__dirname, 'dist-electron'),

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

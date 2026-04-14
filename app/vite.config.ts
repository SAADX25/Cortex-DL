import { defineConfig } from 'vite'
import path from 'node:path'
import fs from 'node:fs'
import electron from 'vite-plugin-electron/simple'
import react from '@vitejs/plugin-react'

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf-8'))

// https://vitejs.dev/config/
export default defineConfig(({ command, mode }) => {
  const isBuild = command === 'build'

  return {
    root: path.join(__dirname, 'Front-End'),
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
    build: {
      sourcemap: false,
      minify: 'esbuild'
    },
    plugins: [
      react(),
      electron({
        main: {
          entry: path.join(__dirname, 'Back-End', 'electron', 'main.ts'),
          vite: {
            build: {
              outDir: path.join(__dirname, 'dist-electron'),
              rollupOptions: {
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

import { defineConfig } from 'vite'
import path from 'node:path'
import fs from 'node:fs'
import electron from 'vite-plugin-electron/simple'
import react from '@vitejs/plugin-react'
import obfuscator from 'rollup-plugin-obfuscator'

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
      isBuild && obfuscator({
        global: true,
        options: {
          compact: true,
          controlFlowFlattening: true,
          controlFlowFlatteningThreshold: 0.75,
          deadCodeInjection: true,
          deadCodeInjectionThreshold: 0.4,
          debugProtection: false,
          debugProtectionInterval: 0,
          disableConsoleOutput: true,
          identifierNamesGenerator: 'hexadecimal',
          log: false,
          numbersToExpressions: true,
          renameGlobals: false,
          selfDefending: true,
          simplify: true,
          splitStrings: true,
          splitStringsChunkLength: 10,
          stringArray: true,
          stringArrayCallsTransform: true,
          stringArrayCallsTransformThreshold: 0.75,
          stringArrayEncoding: ['rc4'],
          stringArrayIndexShift: true,
          stringArrayRotate: true,
          stringArrayShuffle: true,
          stringArrayWrappersCount: 2,
          stringArrayWrappersChainedCalls: true,
          stringArrayWrappersParametersMaxCount: 4,
          stringArrayWrappersType: 'function',
          stringArrayThreshold: 0.75,
          transformObjectKeys: true,
          unicodeEscapeSequence: false
        }
      })
    ],
  }
})

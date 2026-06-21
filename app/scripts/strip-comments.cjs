/**
 * strip-comments.cjs
 * Removes all // line comments and /* block comments from .ts and .tsx files.
 * Run: node scripts/strip-comments.cjs
 */

const fs = require('fs')
const path = require('path')

// Directories to process (relative to this script's location = app/)
const TARGET_DIRS = [
  path.join(__dirname, '..', 'Back-End'),
  path.join(__dirname, '..', 'Front-End', 'src'),
]

const EXTENSIONS = new Set(['.ts', '.tsx'])

// ──────────────────────────────────────────────
// Core: remove comments from a source string.
// Handles:
//   • // single-line comments
//   • /* ... */ block comments (including multi-line)
//   • Strings  "...", '...', `...`  (not touched)
//   • RegExp literals  /.../        (not touched)
// ──────────────────────────────────────────────
function stripComments(source) {
  let result = ''
  let i = 0
  const len = source.length

  function peek(offset = 1) {
    return i + offset < len ? source[i + offset] : ''
  }

  while (i < len) {
    const ch = source[i]

    // ── String literals ────────────────────────
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch
      result += ch
      i++
      while (i < len) {
        const sc = source[i]
        result += sc
        i++
        if (sc === '\\') {          // escape next char
          if (i < len) { result += source[i]; i++ }
          continue
        }
        if (sc === quote) break     // end of string
        // Template literal expressions ${ … }
        if (quote === '`' && sc === '$' && source[i] === '{') {
          result += source[i]; i++ // consume '{'
          let depth = 1
          while (i < len && depth > 0) {
            const tc = source[i]
            result += tc; i++
            if (tc === '{') depth++
            else if (tc === '}') depth--
          }
        }
      }
      continue
    }

    // ── Line comment  // ───────────────────────
    if (ch === '/' && peek() === '/') {
      // Consume until end-of-line but KEEP the newline
      while (i < len && source[i] !== '\n') i++
      continue
    }

    // ── Block comment  /* … */ ─────────────────
    if (ch === '/' && peek() === '*') {
      i += 2 // skip /*
      while (i < len) {
        if (source[i] === '*' && peek() === '/') {
          i += 2 // skip */
          break
        }
        // Preserve newlines inside block comments so line numbers stay intact
        if (source[i] === '\n') result += '\n'
        i++
      }
      continue
    }

    result += ch
    i++
  }

  return result
}

// ──────────────────────────────────────────────
// Clean up leftover blank lines (max 2 in a row)
// ──────────────────────────────────────────────
function collapseBlankLines(src) {
  return src.replace(/(\r?\n){3,}/g, '\n\n')
}

// ──────────────────────────────────────────────
// Walk a directory recursively
// ──────────────────────────────────────────────
function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      // Skip node_modules, dist, build folders
      if (['node_modules', 'dist', 'build', 'dist-electron'].includes(entry.name)) continue
      walk(full, files)
    } else if (entry.isFile() && EXTENSIONS.has(path.extname(entry.name))) {
      files.push(full)
    }
  }
  return files
}

// ──────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────
let totalFiles = 0
let totalSaved = 0

for (const dir of TARGET_DIRS) {
  if (!fs.existsSync(dir)) {
    console.warn(`[SKIP] Directory not found: ${dir}`)
    continue
  }

  const files = walk(dir)
  for (const file of files) {
    const original = fs.readFileSync(file, 'utf8')
    const stripped = collapseBlankLines(stripComments(original))

    if (stripped !== original) {
      fs.writeFileSync(file, stripped, 'utf8')
      const savedBytes = original.length - stripped.length
      console.log(`[STRIPPED] ${path.relative(process.cwd(), file)}  (-${savedBytes} bytes)`)
      totalSaved += savedBytes
    } else {
      console.log(`[  OK   ] ${path.relative(process.cwd(), file)}  (no comments)`)
    }

    totalFiles++
  }
}

console.log(`\nDone! Processed ${totalFiles} files, removed ~${totalSaved} bytes of comments.`)

import Database from 'better-sqlite3'
import { app } from 'electron'
import path from 'node:path'

const userDataPath = app.getPath('userData')
const dbPath = path.join(userDataPath, 'tasks.sqlite')

export const db = new Database(dbPath)

db.pragma('journal_mode = WAL')

db.pragma('auto_vacuum = INCREMENTAL')

// NORMAL is the recommended pairing with WAL: it skips the fsync on every
// transaction commit (only checkpointing needs one), which is safe here
// because WAL already guarantees the database file itself can never be
// corrupted by a crash — at worst a handful of milliseconds of the most
// recent writes could be lost, which is an explicit, accepted trade-off of
// the write-behind persistence model in `downloadManager.ts` (Priority 3).
db.pragma('synchronous = NORMAL')

db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    title TEXT,
    url TEXT,
    status TEXT,
    progress REAL,
    size INTEGER,
    thumbnail TEXT,
    engine TEXT,
    full_payload TEXT
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`)

export const taskDb = {
  upsertTask: db.prepare(`
    INSERT INTO tasks (id, title, url, status, progress, size, thumbnail, engine, full_payload)
    VALUES (@id, @title, @url, @status, @progress, @size, @thumbnail, @engine, @full_payload)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      url = excluded.url,
      status = excluded.status,
      progress = excluded.progress,
      size = excluded.size,
      thumbnail = excluded.thumbnail,
      engine = excluded.engine,
      full_payload = excluded.full_payload
  `),

  updateStatusAndProgress: db.prepare(`
    UPDATE tasks 
    SET status = @status, progress = @progress, full_payload = @full_payload
    WHERE id = @id
  `),

  deleteTask: db.prepare(`
    DELETE FROM tasks WHERE id = ?
  `),

  getAllTasks: db.prepare(`
    SELECT full_payload FROM tasks
  `),
  
  clearCompleted: db.prepare(`
    DELETE FROM tasks WHERE status = 'completed' OR status = 'canceled'
  `)
}

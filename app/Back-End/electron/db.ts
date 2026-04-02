import Database from 'better-sqlite3'
import { app } from 'electron'
import path from 'node:path'

const userDataPath = app.getPath('userData')
const dbPath = path.join(userDataPath, 'tasks.sqlite')

export const db = new Database(dbPath)

// Enable WAL mode for maximum concurrency and performance
db.pragma('journal_mode = WAL')

// Set auto_vacuum so the DB doesn't grow infinitely forever
db.pragma('auto_vacuum = INCREMENTAL')

// Initialize the table precisely matching the Phase 1 requirements + a payload column
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
  )
`)

// Prepared Statements for blazing fast execution
export const taskDb = {
  // Upsert a full task (used when saving pure state or inserting new ones)
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

  // Surgical UPDATE for status and progress (highly concurrent / fast)
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

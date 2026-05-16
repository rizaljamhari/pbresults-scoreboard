import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { builtinThemes } from "../shared/builtinThemes.js";
import { defaultSettings } from "../shared/theme.js";
const dataDir = path.resolve(process.cwd(), "data");
const databasePath = path.join(dataDir, "scoreboard.db");
fs.mkdirSync(dataDir, { recursive: true });
export const db = new Database(databasePath);
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS themes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    builtin INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    data TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS assets (
    id TEXT PRIMARY KEY,
    original_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    url TEXT NOT NULL,
    file_path TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);
const upsertSetting = db.prepare(`
  INSERT INTO settings (key, value)
  VALUES (@key, @value)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`);
for (const [key, value] of Object.entries(defaultSettings)) {
    const existing = db.prepare("SELECT key FROM settings WHERE key = ?").get(key);
    if (!existing) {
        upsertSetting.run({ key, value: JSON.stringify(value) });
    }
}
const insertTheme = db.prepare(`
  INSERT INTO themes (id, name, builtin, created_at, updated_at, data)
  VALUES (@id, @name, @builtin, @createdAt, @updatedAt, @data)
`);
for (const theme of builtinThemes) {
    const existing = db.prepare("SELECT id FROM themes WHERE id = ?").get(theme.id);
    if (!existing) {
        const now = new Date().toISOString();
        insertTheme.run({
            id: theme.id,
            name: theme.name,
            builtin: 1,
            createdAt: now,
            updatedAt: now,
            data: JSON.stringify(theme)
        });
    }
}

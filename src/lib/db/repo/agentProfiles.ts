import type { SqliteDb } from "../connection";
import { nowIso } from "./now";

export type SupportedCli = "claude" | "codex" | "jcode";

export interface AgentProfileRow {
  id: number;
  name: string;
  cli: SupportedCli;
  model: string | null;
  provider: string | null;
  transport: "stdin" | "argv";
  timeout_ms: number;
  enabled: 0 | 1;
  config_revision: number;
  capabilities: string | null;
  last_validated_at: string | null;
  last_validation_ok: 0 | 1 | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProfileInput {
  name: string;
  cli: SupportedCli;
  model?: string | null;
  provider?: string | null;
  transport?: "stdin" | "argv";
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 120_000;

export function listProfiles(db: SqliteDb): AgentProfileRow[] {
  return db.prepare(`SELECT * FROM agent_profiles ORDER BY id`).all() as AgentProfileRow[];
}

export function getProfile(db: SqliteDb, id: number): AgentProfileRow | null {
  const row = db.prepare(`SELECT * FROM agent_profiles WHERE id = ?`).get(id) as
    | AgentProfileRow
    | undefined;
  return row ?? null;
}

export function createProfile(db: SqliteDb, input: ProfileInput, capabilitiesJson: string | null): AgentProfileRow {
  const ts = nowIso();
  const result = db
    .prepare(
      `INSERT INTO agent_profiles
         (name, cli, model, provider, transport, timeout_ms, capabilities, config_revision, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    )
    .run(
      input.name.trim(),
      input.cli,
      input.model ?? null,
      input.provider ?? null,
      input.transport ?? "stdin",
      input.timeoutMs && input.timeoutMs >= 5_000 ? input.timeoutMs : DEFAULT_TIMEOUT_MS,
      capabilitiesJson,
      ts,
      ts,
    );
  return getProfile(db, Number(result.lastInsertRowid))!;
}

export interface ProfilePatch {
  name?: string;
  model?: string | null;
  provider?: string | null;
  transport?: "stdin" | "argv";
  timeoutMs?: number;
  enabled?: boolean;
  capabilitiesJson?: string | null;
}

/** Profil güncellemesi config_revision'ı artırır; eski işler kendi snapshot'ıyla yaşar. */
export function updateProfile(db: SqliteDb, id: number, patch: ProfilePatch): AgentProfileRow | null {
  const current = getProfile(db, id);
  if (!current) return null;
  const ts = nowIso();
  db.prepare(
    `UPDATE agent_profiles SET
       name = ?, model = ?, provider = ?, transport = ?, timeout_ms = ?, enabled = ?,
       capabilities = COALESCE(?, capabilities),
       config_revision = config_revision + 1, updated_at = ?
     WHERE id = ?`,
  ).run(
    patch.name?.trim() ?? current.name,
    patch.model !== undefined ? patch.model : current.model,
    patch.provider !== undefined ? patch.provider : current.provider,
    patch.transport ?? current.transport,
    patch.timeoutMs && patch.timeoutMs >= 5_000 ? patch.timeoutMs : current.timeout_ms,
    patch.enabled === undefined ? current.enabled : patch.enabled ? 1 : 0,
    patch.capabilitiesJson !== undefined ? patch.capabilitiesJson : null,
    ts,
    id,
  );
  return getProfile(db, id);
}

export function deleteProfile(db: SqliteDb, id: number): boolean {
  const result = db.prepare(`DELETE FROM agent_profiles WHERE id = ?`).run(id);
  if (result.changes > 0) {
    const defaultId = getDefaultProfileId(db);
    if (defaultId === id) setDefaultProfileId(db, null);
    return true;
  }
  return false;
}

export function setValidationResult(
  db: SqliteDb,
  id: number,
  ok: boolean,
  error: string | null,
): void {
  db.prepare(
    `UPDATE agent_profiles SET last_validated_at = ?, last_validation_ok = ?, last_error = ?, updated_at = ?
     WHERE id = ?`,
  ).run(nowIso(), ok ? 1 : 0, error, nowIso(), id);
}

export function getDefaultProfileId(db: SqliteDb): number | null {
  const row = db.prepare(`SELECT value FROM meta WHERE key = 'default_agent_profile_id'`).get() as
    | { value: string }
    | undefined;
  if (!row) return null;
  const id = Number(row.value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function setDefaultProfileId(db: SqliteDb, profileId: number | null): void {
  if (profileId === null) {
    db.prepare(`DELETE FROM meta WHERE key = 'default_agent_profile_id'`).run();
    return;
  }
  db.prepare(
    `INSERT INTO meta (key, value) VALUES ('default_agent_profile_id', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(String(profileId));
}

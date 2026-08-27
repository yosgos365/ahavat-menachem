import { DatabaseSync } from "node:sqlite";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { TASHפו_USERS } from "./src/lastYearData";

export type SeatStatus = "available" | "pending" | "taken";
export type RequestStatus = "pending" | "approved" | "rejected";

export interface SeatChange {
  seatId: string;
  type: "released" | "transferred";
  timestamp: number;
}

export interface RequestRecord {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  seats: string[];
  requestedSeats: string[];
  status: RequestStatus;
  rejectionReason?: string;
  isLastYearUser: boolean;
  lastYearIdentityConfirmed: boolean;
  lastYearChoice: "same-seat" | "different-seats" | "not-confirmed";
  isDemo: boolean;
  paymentImage: string;
  timestamp: number;
  lastYearSeats: string[];
  seatChanges: SeatChange[];
}

export interface AuditRecord {
  id: number;
  timestamp: number;
  actor: string;
  action: string;
  seatId?: string;
  fromOwner?: string;
  toOwner?: string;
  requestId?: string;
  details?: string;
}

export interface DashboardData {
  requests: RequestRecord[];
  seats: Record<string, { status: SeatStatus; owner?: string; reservedBy?: string }>;
  lastYearUsers: Array<{ id: string; firstName: string; lastName: string; seats: string[] }>;
  auditLog: AuditRecord[];
}

export interface ApplicationState {
  seats: DashboardData["seats"];
  requests: RequestRecord[];
  lastYearUsers: DashboardData["lastYearUsers"];
}

// In production this points to Render's persistent disk; locally it remains the project folder.
const ROOT = process.env.DATA_DIR || process.cwd();
const DB_PATH = path.join(ROOT, "synagogue.db");
const LEGACY_PATH = path.join(ROOT, "database.json");
const BACKUP_DIR = path.join(ROOT, "backups");
const SESSION_DURATION_MS = 8 * 60 * 60 * 1000;

let db: DatabaseSync;
let firestorePromise: Promise<ReturnType<typeof getFirestore> | null> | null = null;

async function firestoreForProduction() {
  if (process.env.USE_FIRESTORE !== "true") return null;
  if (firestorePromise) return firestorePromise;
  firestorePromise = (async () => {
    try {
      const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || await fs.readFile(process.env.FIREBASE_SERVICE_ACCOUNT_PATH || path.join(process.cwd(), "firebase-service-account.json"), "utf8");
      if (!getApps().length) initializeApp({ credential: cert(JSON.parse(raw)) });
      return getFirestore();
    } catch (error) {
      console.error("חיבור Firestore נכשל", error);
      return null;
    }
  })();
  return firestorePromise;
}

async function syncFromFirestore() {
  const firestore = await firestoreForProduction();
  if (!firestore) return;
  const snapshot = await firestore.collection("system").doc("applicationState").get();
  const state = snapshot.data() as ApplicationState | undefined;
  if (!state?.requests || !state.seats || !state.lastYearUsers) return;
  db.exec("BEGIN");
  try {
    db.exec("DELETE FROM seats; DELETE FROM requests; DELETE FROM last_year_users;");
    for (const [id, seat] of Object.entries(state.seats)) db.prepare("INSERT INTO seats (id, status, owner, reserved_by) VALUES (?, ?, ?, ?)").run(id, seat.status, seat.owner || null, seat.reservedBy || null);
    for (const request of state.requests) db.prepare("INSERT INTO requests (id, first_name, last_name, phone, seats_json, requested_seats_json, status, rejection_reason, is_last_year_user, payment_image, timestamp, last_year_seats_json, seat_changes_json, last_year_identity_confirmed, last_year_choice, is_demo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(request.id, request.firstName, request.lastName, request.phone, JSON.stringify(request.seats), JSON.stringify(request.requestedSeats || request.seats), request.status, request.rejectionReason || null, request.isLastYearUser ? 1 : 0, request.paymentImage, request.timestamp, JSON.stringify(request.lastYearSeats || []), JSON.stringify(request.seatChanges || []), request.lastYearIdentityConfirmed ? 1 : 0, request.lastYearChoice || "not-confirmed", request.isDemo ? 1 : 0);
    for (const user of state.lastYearUsers) db.prepare("INSERT INTO last_year_users (id, first_name, last_name, seats_json) VALUES (?, ?, ?, ?)").run(user.id, user.firstName, user.lastName, JSON.stringify(user.seats));
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

async function syncToFirestore(state: ApplicationState) {
  const firestore = await firestoreForProduction();
  if (firestore) await firestore.collection("system").doc("applicationState").set({ ...state, updatedAt: Date.now() });
}

const parseJson = <T>(value: string | null | undefined, fallback: T): T => {
  try { return value ? JSON.parse(value) as T : fallback; } catch { return fallback; }
};

const requestFromRow = (row: any): RequestRecord => ({
  id: row.id,
  firstName: row.first_name,
  lastName: row.last_name,
  phone: row.phone,
  seats: parseJson(row.seats_json, []),
  requestedSeats: parseJson(row.requested_seats_json, parseJson(row.seats_json, [])),
  status: row.status,
  rejectionReason: row.rejection_reason || undefined,
  isLastYearUser: Boolean(row.is_last_year_user),
  lastYearIdentityConfirmed: Boolean(row.last_year_identity_confirmed),
  lastYearChoice: row.last_year_choice === "same-seat" || row.last_year_choice === "different-seats" ? row.last_year_choice : "not-confirmed",
  isDemo: Boolean(row.is_demo),
  paymentImage: row.payment_image || "",
  timestamp: Number(row.timestamp),
  lastYearSeats: parseJson(row.last_year_seats_json, []),
  seatChanges: parseJson(row.seat_changes_json, []),
});

const passwordHash = (password: string, salt: string) => crypto.pbkdf2Sync(password, salt, 210_000, 32, "sha256").toString("hex");

const setting = (key: string) => db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value?: string } | undefined;
const setSetting = (key: string, value: string) => db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);

type AuditOptions = Omit<AuditRecord, "id" | "timestamp" | "action" | "actor"> & { actor?: string };

function addAudit(action: string, options: AuditOptions = {}) {
  db.prepare("INSERT INTO seat_audit (timestamp, actor, action, seat_id, from_owner, to_owner, request_id, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(Date.now(), options.actor || "מנהל", action, options.seatId || null, options.fromOwner || null, options.toOwner || null, options.requestId || null, options.details || null);
}

async function importLegacyDatabase() {
  try {
    const legacy = JSON.parse(await fs.readFile(LEGACY_PATH, "utf8"));
    const alreadyImported = setting("legacy_imported")?.value === "true";
    if (alreadyImported) return;

    db.exec("BEGIN");
    try {
      const password = typeof legacy.adminPassword === "string" ? legacy.adminPassword : "mmbm";
      setPassword(password);

      for (const [id, seat] of Object.entries(legacy.seats || {}) as Array<[string, any]>) {
        db.prepare("INSERT OR REPLACE INTO seats (id, status, owner, reserved_by) VALUES (?, ?, ?, ?)")
          .run(id, seat.status, seat.owner || null, seat.reservedBy || null);
      }
      for (const item of legacy.requests || []) {
        db.prepare("INSERT OR REPLACE INTO requests (id, first_name, last_name, phone, seats_json, requested_seats_json, status, rejection_reason, is_last_year_user, payment_image, timestamp, last_year_seats_json, seat_changes_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .run(item.id, item.firstName || "", item.lastName || "", item.phone || "", JSON.stringify(item.seats || []), JSON.stringify(item.requestedSeats || item.seats || []), item.status || "pending", item.rejectionReason || null, item.isLastYearUser ? 1 : 0, item.paymentImage || "", item.timestamp || Date.now(), JSON.stringify(item.lastYearSeats || []), JSON.stringify(item.seatChanges || []));
      }
      for (const item of legacy.lastYearUsers || []) {
        db.prepare("INSERT OR REPLACE INTO last_year_users (id, first_name, last_name, seats_json) VALUES (?, ?, ?, ?)")
          .run(item.id, item.firstName, item.lastName, JSON.stringify(item.seats || []));
      }
      setSetting("legacy_imported", "true");
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } catch (error: any) {
    if (error?.code !== "ENOENT") throw error;
    if (!setting("password_hash")) setPassword("mmbm");
  }
}

export async function initDatabase() {
  await fs.mkdir(BACKUP_DIR, { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS seats (id TEXT PRIMARY KEY, status TEXT NOT NULL, owner TEXT, reserved_by TEXT);
    CREATE TABLE IF NOT EXISTS requests (
      id TEXT PRIMARY KEY, first_name TEXT NOT NULL, last_name TEXT NOT NULL, phone TEXT NOT NULL,
      seats_json TEXT NOT NULL, requested_seats_json TEXT NOT NULL, status TEXT NOT NULL,
      rejection_reason TEXT, is_last_year_user INTEGER NOT NULL DEFAULT 0, payment_image TEXT,
      timestamp INTEGER NOT NULL, last_year_seats_json TEXT NOT NULL DEFAULT '[]', seat_changes_json TEXT NOT NULL DEFAULT '[]',
      last_year_identity_confirmed INTEGER NOT NULL DEFAULT 0, last_year_choice TEXT NOT NULL DEFAULT 'not-confirmed', is_demo INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS last_year_users (id TEXT PRIMARY KEY, first_name TEXT NOT NULL, last_name TEXT NOT NULL, seats_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS seat_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp INTEGER NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL,
      seat_id TEXT, from_owner TEXT, to_owner TEXT, request_id TEXT, details TEXT
    );
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS login_attempts (ip TEXT NOT NULL, attempted_at INTEGER NOT NULL);
  `);
  try { db.exec("ALTER TABLE requests ADD COLUMN last_year_identity_confirmed INTEGER NOT NULL DEFAULT 0"); } catch { /* existing database */ }
  try { db.exec("ALTER TABLE requests ADD COLUMN last_year_choice TEXT NOT NULL DEFAULT 'not-confirmed'"); } catch { /* existing database */ }
  try { db.exec("ALTER TABLE requests ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0"); } catch { /* existing database */ }
  await importLegacyDatabase();
  if (setting("tashפו_import_version")?.value !== "4") {
    db.exec("BEGIN");
    try {
      db.exec("DELETE FROM last_year_users");
      for (const user of TASHפו_USERS) db.prepare("INSERT INTO last_year_users (id, first_name, last_name, seats_json) VALUES (?, ?, ?, ?)").run(user.id, user.firstName, user.lastName, JSON.stringify(user.seats));
      setSetting("tashפו_import_version", "4");
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  }
  await syncFromFirestore();
  await backupDatabase();
}

export async function backupDatabase() {
  await fs.mkdir(BACKUP_DIR, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const backup = path.join(BACKUP_DIR, `synagogue-${date}.db`);
  await fs.copyFile(DB_PATH, backup);
  const entries = await fs.readdir(BACKUP_DIR);
  const backups = (await Promise.all(entries.filter(name => name.endsWith(".db")).map(async name => ({ name, stat: await fs.stat(path.join(BACKUP_DIR, name)) })))).sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
  await Promise.all(backups.slice(30).map(item => fs.unlink(path.join(BACKUP_DIR, item.name))));
}

export function getDashboardData(): DashboardData {
  const requests = (db.prepare("SELECT * FROM requests ORDER BY timestamp DESC").all() as any[]).map(requestFromRow);
  const seats: DashboardData["seats"] = {};
  for (const row of db.prepare("SELECT * FROM seats").all() as any[]) seats[row.id] = { status: row.status, owner: row.owner || undefined, reservedBy: row.reserved_by || undefined };
  const lastYearUsers = (db.prepare("SELECT * FROM last_year_users").all() as any[]).map(row => ({ id: row.id, firstName: row.first_name, lastName: row.last_name, seats: parseJson(row.seats_json, []) }));
  const auditLog = (db.prepare("SELECT * FROM seat_audit ORDER BY timestamp DESC LIMIT 250").all() as any[]).map(row => ({ id: Number(row.id), timestamp: Number(row.timestamp), actor: row.actor, action: row.action, seatId: row.seat_id || undefined, fromOwner: row.from_owner || undefined, toOwner: row.to_owner || undefined, requestId: row.request_id || undefined, details: row.details || undefined }));
  return { requests, seats, lastYearUsers, auditLog };
}

export function readApplicationState(): ApplicationState {
  const { seats, requests, lastYearUsers } = getDashboardData();
  return { seats, requests, lastYearUsers };
}

export async function writeApplicationState(state: ApplicationState) {
  db.exec("BEGIN");
  try {
    db.exec("DELETE FROM seats; DELETE FROM requests; DELETE FROM last_year_users;");
    for (const [id, seat] of Object.entries(state.seats)) {
      db.prepare("INSERT INTO seats (id, status, owner, reserved_by) VALUES (?, ?, ?, ?)").run(id, seat.status, seat.owner || null, seat.reservedBy || null);
    }
    for (const request of state.requests) {
      db.prepare("INSERT INTO requests (id, first_name, last_name, phone, seats_json, requested_seats_json, status, rejection_reason, is_last_year_user, payment_image, timestamp, last_year_seats_json, seat_changes_json, last_year_identity_confirmed, last_year_choice, is_demo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(request.id, request.firstName, request.lastName, request.phone, JSON.stringify(request.seats), JSON.stringify(request.requestedSeats || request.seats), request.status, request.rejectionReason || null, request.isLastYearUser ? 1 : 0, request.paymentImage, request.timestamp, JSON.stringify(request.lastYearSeats || []), JSON.stringify(request.seatChanges || []), request.lastYearIdentityConfirmed ? 1 : 0, request.lastYearChoice || "not-confirmed", request.isDemo ? 1 : 0);
    }
    for (const user of state.lastYearUsers) {
      db.prepare("INSERT INTO last_year_users (id, first_name, last_name, seats_json) VALUES (?, ?, ?, ?)").run(user.id, user.firstName, user.lastName, JSON.stringify(user.seats));
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  await syncToFirestore(state);
  await backupDatabase();
}

export function getSeatStatuses() {
  const seats: Record<string, { status: SeatStatus }> = {};
  for (const row of db.prepare("SELECT id, status FROM seats").all() as any[]) seats[row.id] = { status: row.status };
  return seats;
}

export function clearAuditLog() {
  db.exec("DELETE FROM seat_audit");
}

export function findLastYearUser(firstName: string, lastName: string) {
  // Besides an exact match, allow the common Hebrew spelling variants with or
  // without ו/י (אהרן/אהרון, שטינר/שטיינר) and a single typing mistake.
  const normalize = (value: string) => value.trim().replace(/[׳'\"״]/g, "").replace(/\s+/g, " ").toLowerCase();
  const softNormalize = (value: string) => normalize(value).replace(/[וי]/g, "");
  const distance = (left: string, right: string) => {
    const rows = Array.from({ length: left.length + 1 }, (_, index) => index);
    for (let column = 1; column <= right.length; column += 1) {
      let previous = rows[0];
      rows[0] = column;
      for (let row = 1; row <= left.length; row += 1) {
        const current = rows[row];
        rows[row] = Math.min(rows[row] + 1, rows[row - 1] + 1, previous + (left[row - 1] === right[column - 1] ? 0 : 1));
        previous = current;
      }
    }
    return rows[left.length];
  };
  const matchesPart = (entered: string, stored: string) => {
    const exact = normalize(entered);
    const saved = normalize(stored);
    if (exact === saved || softNormalize(exact) === softNormalize(saved)) return true;
    return Math.min(exact.length, saved.length) >= 4 && distance(exact, saved) <= 1;
  };
  const row = (db.prepare("SELECT * FROM last_year_users").all() as any[]).find((item) => {
    const storedParts = [item.first_name, item.last_name].map(normalize).filter(Boolean);
    // One-word historic entries are ambiguous: they can be either a first or
    // a family name. Ask for confirmation whenever either entered part fits.
    if (storedParts.length === 1) return matchesPart(firstName || "", storedParts[0]) || matchesPart(lastName || "", storedParts[0]);
    // Some source rows have first/family names reversed. Accept both orders;
    // the public confirmation dialog remains the final safeguard.
    return (matchesPart(firstName || "", item.first_name) && matchesPart(lastName || "", item.last_name)) ||
      (matchesPart(firstName || "", item.last_name) && matchesPart(lastName || "", item.first_name));
  });
  return row ? { found: true, name: `${row.first_name} ${row.last_name}`.trim(), seats: parseJson(row.seats_json, []) } : { found: false };
}

export function createRequest(request: RequestRecord) {
  db.prepare("INSERT INTO requests (id, first_name, last_name, phone, seats_json, requested_seats_json, status, is_last_year_user, payment_image, timestamp, last_year_seats_json, seat_changes_json, last_year_identity_confirmed, last_year_choice) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(request.id, request.firstName, request.lastName, request.phone, JSON.stringify(request.seats), JSON.stringify(request.requestedSeats), "pending", request.isLastYearUser ? 1 : 0, request.paymentImage, request.timestamp, JSON.stringify(request.lastYearSeats), "[]", request.lastYearIdentityConfirmed ? 1 : 0, request.lastYearChoice);
  for (const seatId of request.seats) {
    const existing = db.prepare("SELECT status FROM seats WHERE id = ?").get(seatId) as any;
    if (!existing || existing.status === "available") db.prepare("INSERT INTO seats (id, status, reserved_by) VALUES (?, 'pending', ?) ON CONFLICT(id) DO UPDATE SET status = 'pending', reserved_by = excluded.reserved_by, owner = NULL").run(seatId, request.id);
  }
  addAudit("נשלחה בקשה", { actor: "לקוח", requestId: request.id, details: request.seats.join(", ") });
}

export function getRequest(id: string) {
  const row = db.prepare("SELECT * FROM requests WHERE id = ?").get(id) as any;
  return row ? requestFromRow(row) : undefined;
}

export function setPassword(password: string) {
  const salt = crypto.randomBytes(16).toString("hex");
  setSetting("password_salt", salt);
  setSetting("password_hash", passwordHash(password, salt));
}

export function attemptLogin(password: string, ip: string) {
  const now = Date.now();
  db.prepare("DELETE FROM login_attempts WHERE attempted_at < ?").run(now - 15 * 60 * 1000);
  const attempts = db.prepare("SELECT COUNT(*) AS count FROM login_attempts WHERE ip = ?").get(ip) as { count: number };
  if (Number(attempts.count) >= 5) return { success: false, locked: true };
  const salt = setting("password_salt")?.value || "";
  const hash = setting("password_hash")?.value || "";
  const accepted = Boolean(salt && hash) && crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(passwordHash(password, salt), "hex"));
  if (!accepted) {
    db.prepare("INSERT INTO login_attempts (ip, attempted_at) VALUES (?, ?)").run(ip, now);
    return { success: false, locked: false };
  }
  db.prepare("DELETE FROM login_attempts WHERE ip = ?").run(ip);
  const token = crypto.randomBytes(32).toString("base64url");
  db.prepare("INSERT INTO sessions (token_hash, expires_at) VALUES (?, ?)").run(crypto.createHash("sha256").update(token).digest("hex"), now + SESSION_DURATION_MS);
  return { success: true, token };
}

export function isValidSession(token?: string) {
  if (!token) return false;
  const now = Date.now();
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
  return Boolean(db.prepare("SELECT 1 FROM sessions WHERE token_hash = ? AND expires_at > ?").get(crypto.createHash("sha256").update(token).digest("hex"), now));
}

export function revokeSession(token?: string) {
  if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(crypto.createHash("sha256").update(token).digest("hex"));
}

export function addSeatAudit(action: string, options?: AuditOptions) { addAudit(action, options); }

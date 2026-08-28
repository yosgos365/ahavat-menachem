import express from "express";
import cors from "cors";
import crypto from "node:crypto";
import path from "path";
import fs from "fs/promises";
import { Readable } from "node:stream";
import bodyParser from "body-parser";
import { google, drive_v3 } from "googleapis";
import { getApps } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";
import { addSeatAudit, attemptLogin, clearAuditLog, createRequest, findLastYearUser, getDashboardData, getSeatStatuses, initDatabase, isValidSession, readApplicationState, revokeSession, setPassword, writeApplicationState } from "./database";
import { SEATS } from "./src/MapData";

export const app = express();
const PORT = 3000;

app.use(cors());
app.use(bodyParser.json({ limit: "10mb" }));
app.use(bodyParser.urlencoded({ extended: true, limit: "10mb" }));

const DATA_DIR = process.env.DATA_DIR || process.cwd();
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const DRIVE_PAYMENT_FOLDER_ID = process.env.DRIVE_PAYMENT_FOLDER_ID || "1j4rGV1iSveiQlzAErId5hUAKhNe7CTRJ";
const SERVICE_ACCOUNT_PATH = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || path.join(process.cwd(), "firebase-service-account.json");
const GOOGLE_APPS_SCRIPT_URL = process.env.GOOGLE_APPS_SCRIPT_URL || "";
const PAYMENT_STORAGE_SECRET = process.env.PAYMENT_STORAGE_SECRET || "";
const FIREBASE_STORAGE_BUCKET = process.env.FIREBASE_STORAGE_BUCKET || "ahavat-menachem.firebasestorage.app";
const MAX_PAYMENT_IMAGE_BYTES = 5 * 1024 * 1024;
const SEAT_IDS = new Set(SEATS.map((seat) => seat.id));
const DEVELOPER_PASSWORD = process.env.DEVELOPER_PASSWORD || "213223";
const DEVELOPER_SESSION_MS = 15 * 60 * 1000;
let driveClientPromise: Promise<drive_v3.Drive | null> | null = null;

const hasDriveBridge = () => Boolean(GOOGLE_APPS_SCRIPT_URL && PAYMENT_STORAGE_SECRET);
const FIREBASE_IMAGE_PREFIX = "firebase:";
const FIREBASE_IMAGE_TOKEN_PREFIX = "firebase-";

const firebaseStorageBucket = () => {
  // The Firebase Admin app is initialized together with Firestore before any
  // API route is served. Keeping the bucket private means images can only be
  // viewed through our authenticated endpoint below.
  if (!getApps().length) return null;
  return getStorage().bucket(FIREBASE_STORAGE_BUCKET);
};

const firebaseImagePathFromUrl = (imageUrl: string) => {
  if (!imageUrl.startsWith("/api/payment-images/")) return null;
  const id = decodeURIComponent(imageUrl.slice("/api/payment-images/".length));
  return firebaseImagePathFromId(id);
};

const firebaseImagePathFromId = (id: string) => {
  if (id.startsWith(FIREBASE_IMAGE_PREFIX)) return id.slice(FIREBASE_IMAGE_PREFIX.length);
  if (!id.startsWith(FIREBASE_IMAGE_TOKEN_PREFIX)) return null;
  try { return Buffer.from(id.slice(FIREBASE_IMAGE_TOKEN_PREFIX.length), "base64url").toString("utf8"); }
  catch { return null; }
};

async function callDriveBridge(payload: Record<string, string>) {
  if (!hasDriveBridge()) throw new Error("אחסון צילומי התשלום אינו מוגדר");
  const response = await fetch(GOOGLE_APPS_SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ ...payload, secret: PAYMENT_STORAGE_SECRET }),
    redirect: "follow",
  });
  if (!response.ok) throw new Error("שירות שמירת הצילומים אינו זמין");
  const data = await response.json() as { ok?: boolean; error?: string; fileId?: string; mimeType?: string; data?: string };
  if (!data.ok) throw new Error(data.error || "לא ניתן לשמור את צילום התשלום");
  return data;
}

async function readFromDriveBridge(fileId: string) {
  if (!hasDriveBridge()) throw new Error("אחסון צילומי התשלום אינו מוגדר");
  const url = new URL(GOOGLE_APPS_SCRIPT_URL);
  url.searchParams.set("fileId", fileId);
  url.searchParams.set("secret", PAYMENT_STORAGE_SECRET);
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error("שירות הצגת הצילומים אינו זמין");
  const data = await response.json() as { ok?: boolean; error?: string; mimeType?: string; data?: string };
  if (!data.ok || !data.data) throw new Error(data.error || "צילום התשלום לא נמצא");
  return data;
}

const createDeveloperToken = (deviceId: string, expiresAt: number) => {
  const payload = Buffer.from(JSON.stringify({ deviceId, expiresAt })).toString("base64url");
  const signature = crypto.createHmac("sha256", DEVELOPER_PASSWORD).update(payload).digest("base64url");
  return `${payload}.${signature}`;
};

const isDeveloperTokenValid = (token: string, deviceId: string) => {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;
  const expected = crypto.createHmac("sha256", DEVELOPER_PASSWORD).update(payload).digest("base64url");
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return data.deviceId === deviceId && Number(data.expiresAt) > Date.now();
  } catch { return false; }
};

async function getDriveClient(): Promise<drive_v3.Drive | null> {
  if (driveClientPromise) return driveClientPromise;
  driveClientPromise = (async () => {
    try {
      const rawCredentials = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || await fs.readFile(SERVICE_ACCOUNT_PATH, "utf8");
      const credentials = JSON.parse(rawCredentials);
      const auth = new google.auth.GoogleAuth({ credentials, scopes: ["https://www.googleapis.com/auth/drive"] });
      return google.drive({ version: "v3", auth });
    } catch (error) {
      console.warn("Google Drive אינו מוגדר; הצילומים נשמרים זמנית מקומית.", error instanceof Error ? error.message : error);
      return null;
    }
  })();
  return driveClientPromise;
}

const validateSeatList = (seats: unknown): seats is string[] =>
  Array.isArray(seats) && seats.length > 0 && seats.every((seat) => typeof seat === "string" && SEAT_IDS.has(seat)) && new Set(seats).size === seats.length;

const canAssignSeat = (db: DBState, seatId: string, requestId?: string) => {
  const seat = db.seats[seatId];
  return !seat || seat.status === "available" || (seat.status === "pending" && seat.reservedBy === requestId);
};

interface DBState {
  seats: Record<string, { status: "available" | "pending" | "taken"; owner?: string; reservedBy?: string }>;
  requests: Array<{
    id: string;
    firstName: string;
    lastName: string;
    phone: string;
    seats: string[];
    status: "pending" | "approved" | "rejected";
    isLastYearUser: boolean;
    isDemo?: boolean;
    lastYearIdentityConfirmed?: boolean;
    lastYearChoice?: "same-seat" | "different-seats" | "not-confirmed";
    paymentImage: string;
    timestamp: number;
    lastYearSeats?: string[];
    requestedSeats?: string[];
    rejectionReason?: string;
    seatChanges?: Array<{
      seatId: string;
      type: "released" | "transferred";
      timestamp: number;
    }>;
  }>;
  lastYearUsers: Array<{
    id: string;
    firstName: string;
    lastName: string;
    seats: string[];
  }>;
}

async function readDB(): Promise<DBState> {
  return readApplicationState() as DBState;
}

async function writeDB(db: DBState): Promise<void> {
  await writeApplicationState({
    seats: db.seats,
    lastYearUsers: db.lastYearUsers,
    requests: db.requests.map((request) => ({
      ...request,
      requestedSeats: request.requestedSeats ?? request.seats,
      lastYearSeats: request.lastYearSeats ?? [],
      seatChanges: request.seatChanges ?? [],
      lastYearIdentityConfirmed: request.lastYearIdentityConfirmed ?? false,
      lastYearChoice: request.lastYearChoice ?? "not-confirmed",
      isDemo: request.isDemo ?? false,
    })),
  });
}

async function storePaymentImage(paymentImage: unknown, requestId: string): Promise<string> {
  if (typeof paymentImage !== "string") throw new Error("חסרה תמונת תשלום");
  const match = paymentImage.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error("יש להעלות תמונת JPG, PNG או WebP תקינה");
  const image = Buffer.from(match[2], "base64");
  if (!image.length || image.length > MAX_PAYMENT_IMAGE_BYTES) throw new Error("גודל תמונת התשלום המרבי הוא 5MB");
  const extension = match[1] === "image/png" ? "png" : match[1] === "image/webp" ? "webp" : "jpg";
  const filename = `${requestId}.${extension}`;
  const bucket = firebaseStorageBucket();
  if (bucket) {
    const objectName = `payment-images/${filename}`;
    await bucket.file(objectName).save(image, {
      resumable: false,
      metadata: {
        contentType: match[1],
        cacheControl: "private, no-store",
        metadata: { requestId },
      },
    });
    // Keep the path slash-free: Netlify decodes encoded slashes in redirects.
    // A base64url token is safe both in a route parameter and in the database.
    return `/api/payment-images/${FIREBASE_IMAGE_TOKEN_PREFIX}${Buffer.from(objectName).toString("base64url")}`;
  }
  if (hasDriveBridge()) {
    const stored = await callDriveBridge({ action: "upload", filename, mimeType: match[1], data: match[2] });
    if (!stored.fileId) throw new Error("לא ניתן לשמור את צילום התשלום");
    return `/api/payment-images/${stored.fileId}`;
  }
  const drive = await getDriveClient();
  if (drive) {
    const created = await drive.files.create({
      requestBody: { name: filename, parents: [DRIVE_PAYMENT_FOLDER_ID], mimeType: match[1] },
      media: { mimeType: match[1], body: Readable.from(image) },
      fields: "id",
      supportsAllDrives: true,
    });
    if (!created.data.id) throw new Error("לא ניתן לשמור את צילום התשלום ב-Drive");
    return `/api/payment-images/${created.data.id}`;
  }
  if (process.env.NETLIFY === "true") throw new Error("אחסון צילומי התשלום אינו מוגדר");
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  await fs.writeFile(path.join(UPLOAD_DIR, filename), image);
  return `/uploads/${filename}`;
}

async function migrateLegacyPaymentImages() {
  const db = await readDB();
  let changed = false;
  for (const request of db.requests) {
    if (!request.paymentImage?.startsWith("data:image/")) continue;
    try {
      request.paymentImage = await storePaymentImage(request.paymentImage, request.id);
      changed = true;
    } catch {
      // Preserve an unreadable legacy record rather than deleting payment evidence.
    }
  }
  if (changed) await writeDB(db);
}

// Authentication middleware
const adminAuth = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.replace(/^Bearer\s+/, "");
  if (isValidSession(token)) {
    next();
  } else {
    res.status(401).json({ error: "תוקף ההתחברות פג. יש להתחבר מחדש." });
  }
};

const developerAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const token = req.header("X-Developer-Token") || "";
  const deviceId = req.header("X-Developer-Device") || "";
  if (!isDeveloperTokenValid(token, deviceId)) {
    return res.status(403).json({ error: "נדרשת כניסת מפתח מהמכשיר המורשה." });
  }
  next();
};

// --- API ROUTES ---

app.use("/uploads", express.static(UPLOAD_DIR));

// Public: Get all seats status (without names)
app.get("/api/seats", async (req, res) => {
  res.json(getSeatStatuses());
});

// Public: Check if user exists in last year DB
app.post("/api/check-last-year", async (req, res) => {
  const { firstName, lastName } = req.body;
  res.json(findLastYearUser(firstName, lastName));
});

app.post("/api/admin/developer/unlock", adminAuth, (req, res) => {
  const password = typeof req.body.password === "string" ? req.body.password : "";
  const deviceId = typeof req.body.deviceId === "string" ? req.body.deviceId.trim() : "";
  if (!deviceId || password !== DEVELOPER_PASSWORD) return res.status(403).json({ error: "סיסמת המפתח אינה נכונה." });
  const expiresAt = Date.now() + DEVELOPER_SESSION_MS;
  res.json({ token: createDeveloperToken(deviceId, expiresAt), expiresAt });
});

const deleteStoredPaymentImage = async (imageUrl: string) => {
  const firebasePath = firebaseImagePathFromUrl(imageUrl);
  if (firebasePath) {
    const bucket = firebaseStorageBucket();
    if (bucket) await bucket.file(firebasePath).delete({ ignoreNotFound: true }).catch(() => undefined);
    return;
  }
  if (imageUrl.startsWith("/api/payment-images/")) {
    const fileId = imageUrl.slice("/api/payment-images/".length);
    if (hasDriveBridge()) {
      if (fileId) await callDriveBridge({ action: "delete", fileId }).catch(() => undefined);
      return;
    }
    const drive = await getDriveClient();
    if (drive && fileId) await drive.files.delete({ fileId, supportsAllDrives: true }).catch(() => undefined);
    return;
  }
  if (!imageUrl.startsWith("/uploads/")) return;
  const filename = path.basename(imageUrl);
  await fs.unlink(path.join(UPLOAD_DIR, filename)).catch(() => undefined);
};

const servePaymentImage = async (req: express.Request, res: express.Response) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  if (!isValidSession(token)) return res.status(401).end();
  // The wildcard keeps legacy Firebase links readable after Netlify decodes
  // their %2F during the function redirect.
  const fileId = typeof req.params.fileId === "string"
    ? req.params.fileId
    : (typeof req.params[0] === "string" ? req.params[0] : "");
  const firebasePath = firebaseImagePathFromId(fileId);
  if (firebasePath) {
    const bucket = firebaseStorageBucket();
    if (!bucket) return res.status(503).end();
    try {
      const file = bucket.file(firebasePath);
      // Firebase signs this short-lived URL on the server. The browser then
      // fetches the image directly from Storage, avoiding serverless-http's
      // unreliable binary-response handling in a Netlify Function.
      const [signedUrl] = await file.getSignedUrl({
        version: "v4",
        action: "read",
        expires: Date.now() + 5 * 60 * 1000,
      });
      res.setHeader("Cache-Control", "private, no-store");
      res.redirect(302, signedUrl);
    } catch {
      res.status(404).end();
    }
    return;
  }
  if (hasDriveBridge()) {
    try {
      const image = await readFromDriveBridge(fileId);
      res.setHeader("Cache-Control", "private, no-store");
      res.type(image.mimeType || "image/jpeg").send(Buffer.from(image.data!, "base64"));
    } catch {
      res.status(404).end();
    }
    return;
  }
  const drive = await getDriveClient();
  if (!drive) return res.status(503).end();
  try {
    const image = await drive.files.get({ fileId, alt: "media", supportsAllDrives: true }, { responseType: "stream" });
    res.setHeader("Cache-Control", "private, no-store");
    (image.data as any).pipe(res);
  } catch {
    res.status(404).end();
  }
};

// New paths are slash-free and use the stable parameter route. The wildcard
// remains only for older records whose Firebase object path contains '/'.
app.get("/api/payment-images/:fileId", servePaymentImage);
app.get("/api/payment-images/*", servePaymentImage);

app.post("/api/admin/developer/clear-requests", developerAuth, async (req, res) => {
  const db = await readDB();
  await Promise.all(db.requests.map(request => deleteStoredPaymentImage(request.paymentImage)));
  db.requests = [];
  db.seats = {};
  await writeDB(db);
  clearAuditLog();
  res.json({ success: true });
});

app.post("/api/admin/developer/create-demo", developerAuth, async (req, res) => {
  const db = await readDB();
  const now = Date.now();
  const variation = Math.floor(Math.random() * 9000) + 1000;
  const freeSeatIds = SEATS.filter(seat => !db.seats[seat.id] || db.seats[seat.id].status === "available").map(seat => seat.id);
  const zones = ["A", "C", "E", "G", "I", "K", "M", "O", "Q", "S", "U", "V", "WA", "WC", "WE", "WG", "WI", "WK", "WM", "WO"];
  const zoneGroups = zones.map(zone => freeSeatIds.filter(seat => seat.startsWith(zone)));
  const availableSeats: string[] = [];
  for (let index = 0; availableSeats.length < freeSeatIds.length; index += 1) {
    let added = false;
    for (const group of zoneGroups) {
      if (!group.length) continue;
      const seat = group[(index + variation) % group.length];
      if (!availableSeats.includes(seat)) { availableSeats.push(seat); added = true; }
    }
    if (!added) break;
  }
  for (const seat of freeSeatIds) if (!availableSeats.includes(seat)) availableSeats.push(seat);
  if (availableSeats.length < 23) return res.status(400).json({ error: "אין די מושבים פנויים ליצירת הדגמה. נקה תחילה את נתוני ההדגמה." });

  const historic = db.lastYearUsers.find(user => user.seats.some(seat => freeSeatIds.includes(seat))) || { firstName: "ישראל", lastName: "ישראלי", seats: [availableSeats[0]] };
  const historicSeat = historic.seats.find(seat => freeSeatIds.includes(seat)) || availableSeats[0];
  const demoSeats = availableSeats.filter(seat => seat !== historicSeat);
  const requests: DBState["requests"] = [];
  const addDemo = (firstName: string, lastName: string, seats: string[], status: "pending" | "approved" | "rejected", lastYear?: { seats: string[]; choice: "same-seat" | "different-seats" }) => {
    const id = `demo-${now}-${requests.length}-${Math.random().toString(36).slice(2, 7)}`;
    requests.push({ id, firstName, lastName, phone: `05${String(variation + requests.length).padStart(8, "0").slice(-8)}`, seats, requestedSeats: [...seats], status, isLastYearUser: Boolean(lastYear), isDemo: true, lastYearIdentityConfirmed: Boolean(lastYear), lastYearChoice: lastYear?.choice || "not-confirmed", lastYearSeats: lastYear?.seats || [], paymentImage: "", timestamp: now - requests.length * 60000 });
  };

  // Approved assignments, pending requests, rejections and deliberate duplicates.
  addDemo(historic.firstName, historic.lastName, [demoSeats[0]], "approved", { seats: historic.seats, choice: "same-seat" });
  addDemo("דניאל", "כהן", [demoSeats[1]], "approved");
  addDemo("נועה", "לוי", [demoSeats[2]], "approved");
  addDemo("אליעזר", "פרידמן", [demoSeats[3]], "approved");
  addDemo("מיכל", "ישראל", [demoSeats[4]], "approved");
  addDemo("יונתן", "רוזן", [demoSeats[5]], "approved");
  // Deliberate priority conflict: one requester occupied this exact seat in תשפ״ו.
  addDemo(historic.firstName, historic.lastName, [historicSeat], "pending", { seats: [historicSeat], choice: "same-seat" });
  addDemo("רות", "ברק", [historicSeat], "pending");
  addDemo("שמואל", "קליין", [demoSeats[6]], "pending");
  addDemo("שרה", "דגן", [demoSeats[7], demoSeats[8]], "pending");
  addDemo("יצחק", "רפאלי", [demoSeats[8]], "pending");
  addDemo("יעל", "סגל", [demoSeats[9]], "pending");
  addDemo("אברהם", "פרץ", [demoSeats[10], demoSeats[11]], "pending");
  addDemo("תהילה", "שחר", [demoSeats[12]], "pending");
  addDemo("משה", "אדרי", [demoSeats[13]], "pending");
  addDemo("שירה", "נבון", [demoSeats[13]], "pending");
  addDemo("מאיר", "גולד", [demoSeats[14]], "pending");
  addDemo("חני", "ביטון", [demoSeats[15]], "pending");
  addDemo("יוסף", "גבאי", [demoSeats[16]], "rejected");
  addDemo("אסתר", "מזרחי", [demoSeats[17]], "rejected");
  addDemo("גד", "טויטו", [demoSeats[18]], "pending");
  addDemo("נעמי", "אלון", [demoSeats[19]], "pending");

  db.requests.push(...requests);
  for (const request of requests) {
    for (const seatId of request.seats) {
      if (request.status === "approved") db.seats[seatId] = { status: "taken", owner: `${request.firstName} ${request.lastName}` };
      else if (request.status === "pending" && !db.seats[seatId]) db.seats[seatId] = { status: "pending", reservedBy: request.id };
    }
  }
  await writeDB(db);
  addSeatAudit("נוצרו נתוני הדגמה", { actor: "מפתח", details: `${requests.length} בקשות, גרסה ${variation}` });
  res.json({ success: true, count: requests.length });
});

// Public: Submit a request
app.post("/api/request", async (req, res) => {
  const { firstName, lastName, phone, seats, paymentImage, isLastYearUser, lastYearSeats, lastYearIdentityConfirmed, lastYearChoice } = req.body;
  const normalizedPhone = typeof phone === "string" ? phone.replace(/[\s-]/g, "").replace(/^\+972/, "0") : "";
  const isTestRequest = typeof phone === "string" && phone.trim().toUpperCase() === "TRE";
  if (!isTestRequest && !/^0(?:[2-4]|[8-9]|5\d|7\d)\d{7}$/.test(normalizedPhone)) {
    return res.status(400).json({ error: "יש להזין מספר טלפון ישראלי תקין" });
  }
  if (!validateSeatList(seats)) {
    return res.status(400).json({ error: "בחירת המושבים אינה תקינה" });
  }
  
  const requestId = Date.now().toString() + Math.random().toString(36).substring(7);
  let paymentImageUrl: string;
  try {
    paymentImageUrl = await storePaymentImage(paymentImage, requestId);
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "תמונת התשלום אינה תקינה" });
  }
  
  const newRequest = {
    id: requestId,
    firstName,
    lastName,
    phone: isTestRequest ? "TRE" : normalizedPhone,
    seats,
    requestedSeats: [...seats],
    status: "pending" as const,
    isLastYearUser,
    isDemo: false,
    lastYearIdentityConfirmed: Boolean(lastYearIdentityConfirmed),
    lastYearChoice: lastYearChoice === "same-seat" || lastYearChoice === "different-seats" ? lastYearChoice : "not-confirmed",
    lastYearSeats,
    seatChanges: [],
    paymentImage: paymentImageUrl,
    timestamp: Date.now(),
  };
  
  try {
    // This is a Firestore transaction in production, so another submission or
    // dashboard action cannot overwrite a newly received request.
    await createRequest(newRequest);
    res.json({ success: true, requestId });
  } catch (error) {
    await deleteStoredPaymentImage(paymentImageUrl);
    res.status(503).json({ error: error instanceof Error ? error.message : "לא ניתן לשמור את הבקשה" });
  }
});


app.post("/api/admin/login", async (req, res) => {
  const { password } = req.body;
  const result = attemptLogin(typeof password === "string" ? password : "", req.ip || "unknown");
  if (result.success) {
    res.json({ success: true, token: result.token });
  } else if (result.locked) {
    res.status(429).json({ success: false, error: "נחסמת זמנית עקב ניסיונות התחברות רבים. נסה שוב בעוד 15 דקות." });
  } else {
    res.status(401).json({ success: false, error: "סיסמה שגויה" });
  }
});

app.post("/api/admin/change-password", adminAuth, async (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 4) {
    return res.status(400).json({ error: "Password too short" });
  }
  await setPassword(newPassword);
  res.json({ success: true });
});

app.get("/api/admin/dashboard", adminAuth, async (req, res) => {
  res.json(getDashboardData());
});

app.post("/api/admin/logout", adminAuth, async (req, res) => {
  revokeSession(req.headers.authorization?.replace(/^Bearer\s+/, ""));
  res.json({ success: true });
});

app.post("/api/admin/requests/:id/approve", adminAuth, async (req, res) => {
  const db = await readDB();
  const reqId = req.params.id;
  const request = db.requests.find(r => r.id === reqId);
  
  if (request && request.status === "pending") {
    const hasConflict = db.requests.some((item) => item.status === "pending" && item.id !== request.id && item.seats.some((seatId) => request.seats.includes(seatId)));
    if (!validateSeatList(request.seats) || hasConflict || request.seats.some((seatId) => !canAssignSeat(db, seatId, request.id))) {
      return res.status(409).json({ error: "לא ניתן לאשר בקשה זו ישירות. יש לשבץ מושבים פנויים או לטפל בכפילות." });
    }
    request.requestedSeats ??= [...request.seats];
    request.status = "approved";
    for (const seatId of request.seats) {
      db.seats[seatId] = {
        status: "taken",
        owner: `${request.firstName} ${request.lastName}`
      };
    }
    await writeDB(db);
    request.seats.forEach((seatId) => addSeatAudit("אושר שיבוץ", { seatId, requestId: request.id, toOwner: `${request.firstName} ${request.lastName}` }));
    res.json({ success: true });
  } else {
    res.status(404).json({ error: "Not found" });
  }
});

// Reopen an approved request so the administrator can assign it again.
app.post("/api/admin/requests/:id/reopen", adminAuth, async (req, res) => {
  const db = await readDB();
  const request = db.requests.find(item => item.id === req.params.id);
  if (!request || request.status !== "approved") return res.status(404).json({ error: "הבקשה אינה מאושרת או אינה קיימת" });
  const owner = `${request.firstName} ${request.lastName}`.trim();
  const otherApproved = db.requests.filter(item => item.status === "approved" && item.id !== request.id);
  for (const seatId of request.seats) {
    if (db.seats[seatId]?.status === "taken" && db.seats[seatId]?.owner?.trim() === owner && !otherApproved.some(item => item.seats.includes(seatId))) delete db.seats[seatId];
  }
  request.status = "pending";
  await writeDB(db);
  addSeatAudit("אישור בוטל לצורך שיבוץ מחדש", { actor: "מנהל", requestId: request.id, details: request.seats.join(", ") });
  res.json({ success: true });
});

// Admin resolve conflict (assigning specific seats manually to a request)
app.post("/api/admin/requests/:id/resolve", adminAuth, async (req, res) => {
  const db = await readDB();
  const reqId = req.params.id;
  const { assignedSeats } = req.body;
  const request = db.requests.find(r => r.id === reqId);
  
  if (request && request.status === "pending") {
    if (!validateSeatList(assignedSeats) || assignedSeats.length !== request.seats.length || assignedSeats.some((seatId) => !canAssignSeat(db, seatId, request.id))) {
      return res.status(409).json({ error: "השיבוץ שנבחר אינו פנוי או אינו תקין" });
    }
    const previousSeats = [...request.seats];
    request.requestedSeats ??= [...request.seats];
    request.seats = assignedSeats;
    request.status = "approved";
    for (const seatId of assignedSeats) {
      db.seats[seatId] = {
        status: "taken",
        owner: `${request.firstName} ${request.lastName}`
      };
    }
    // Release any old pending seats originally requested if they are not in assignedSeats
    // and aren't requested by another pending request
    const otherPendingReqs = db.requests.filter(r => r.status === "pending" && r.id !== reqId);
    
    for (const originalSeat of previousSeats) {
       if (!assignedSeats.includes(originalSeat) && db.seats[originalSeat]?.status === "pending") {
         // check if another pending request needs it
         const neededByOther = otherPendingReqs.some(r => r.seats.includes(originalSeat));
         if (!neededByOther) {
             delete db.seats[originalSeat]; // clear status back to available
         }
       }
    }
    await writeDB(db);
    assignedSeats.forEach((seatId) => addSeatAudit("שיבוץ חלופי אושר", { seatId, requestId: request.id, toOwner: `${request.firstName} ${request.lastName}` }));
    res.json({ success: true });
  } else {
    res.status(404).json({ error: "Not found" });
  }
});

app.post("/api/admin/resolve-conflict", adminAuth, async (req, res) => {
  const db = await readDB();
  const { seatId, winnerReqId, loserUpdates } = req.body;
  
  const winnerReq = db.requests.find(r => r.id === winnerReqId);
  const conflictRequests = db.requests.filter(item => item.status === "pending" && item.seats.includes(seatId));
  if (!SEAT_IDS.has(seatId) || !winnerReq || winnerReq.status !== "pending" || !winnerReq.seats.includes(seatId) || !Array.isArray(loserUpdates)) {
    return res.status(400).json({ error: "נתוני טיפול הכפילות אינם תקינים" });
  }
  const expectedLosers = new Set(conflictRequests.filter(item => item.id !== winnerReqId).map(item => item.id));
  if (conflictRequests.length < 2 || loserUpdates.length !== expectedLosers.size || new Set(loserUpdates.map(item => item?.reqId)).size !== expectedLosers.size || loserUpdates.some(item => !expectedLosers.has(item?.reqId))) {
    return res.status(400).json({ error: "יש לבחור מושב חלופי עבור כל מי שלא זכה בכפילות" });
  }
  const replacementSeats = new Set<string>();
  for (const update of loserUpdates) {
    const loser = db.requests.find(item => item.id === update.reqId);
    if (!loser || loser.status !== "pending" || !loser.seats.includes(seatId) || typeof update.newSeat !== "string" || !SEAT_IDS.has(update.newSeat) || replacementSeats.has(update.newSeat) || !canAssignSeat(db, update.newSeat, loser.id)) {
      return res.status(409).json({ error: "אחד מהמושבים החלופיים אינו פנוי או אינו תקין" });
    }
    replacementSeats.add(update.newSeat);
  }

  {
    winnerReq.requestedSeats ??= [...winnerReq.seats];
    winnerReq.status = "approved";
    for (const s of winnerReq.seats) {
      db.seats[s] = {
        status: "taken",
        owner: `${winnerReq.firstName} ${winnerReq.lastName}`
      };
    }
  }

  for (const update of loserUpdates) {
    const loserReq = db.requests.find(r => r.id === update.reqId);
    if (loserReq) {
      loserReq.requestedSeats ??= [...loserReq.seats];
      loserReq.seats = loserReq.seats.map(s => s === seatId ? update.newSeat : s);
      loserReq.status = "approved";
      for (const s of loserReq.seats) {
        db.seats[s] = {
          status: "taken",
          owner: `${loserReq.firstName} ${loserReq.lastName}`
        };
      }
    }
  }

  await writeDB(db);
  addSeatAudit("טופלה כפילות", { requestId: winnerReqId, seatId, details: "שובצו זוכה ומושבים חלופיים" });
  res.json({ success: true });
});

app.post("/api/admin/requests/:id/reject", adminAuth, async (req, res) => {
  const db = await readDB();
  const request = db.requests.find((item) => item.id === req.params.id);
  const reason = typeof req.body.reason === "string" ? req.body.reason.trim() : "";
  if (!request || request.status !== "pending") return res.status(404).json({ error: "הבקשה אינה זמינה לדחייה" });
  if (!reason) return res.status(400).json({ error: "יש להזין סיבת דחייה" });

  request.status = "rejected";
  request.rejectionReason = reason;
  const otherPending = db.requests.filter((item) => item.status === "pending" && item.id !== request.id);
  for (const seatId of request.seats) {
    if (db.seats[seatId]?.status === "pending" && db.seats[seatId].reservedBy === request.id && !otherPending.some((item) => item.seats.includes(seatId))) delete db.seats[seatId];
  }
  await writeDB(db);
  addSeatAudit("בקשה נדחתה", { requestId: request.id, actor: "מנהל", details: reason });
  res.json({ success: true });
});

app.post("/api/admin/requests/:id/delete", adminAuth, async (req, res) => {
  const db = await readDB();
  const reqId = req.params.id;
  const requestIndex = db.requests.findIndex(r => r.id === reqId);
  
  if (requestIndex > -1) {
    const request = db.requests[requestIndex];
    db.requests.splice(requestIndex, 1);
    
    // Clear pending seats if no other request wants them
    const otherPendingReqs = db.requests.filter(r => r.status === "pending");
    for (const seatId of request.seats) {
      if (db.seats[seatId]?.status === "pending") {
        const neededByOther = otherPendingReqs.some(r => r.seats.includes(seatId));
        if (!neededByOther) {
          delete db.seats[seatId];
        }
      }
    }

    if (request.status === "approved") {
      const owner = `${request.firstName} ${request.lastName}`.trim();
      const otherApproved = db.requests.filter((item) => item.status === "approved");
      for (const seatId of request.seats) {
        const seat = db.seats[seatId];
        if (seat?.status === "taken" && seat.owner?.trim() === owner && !otherApproved.some((item) => item.seats.includes(seatId))) {
          delete db.seats[seatId];
          addSeatAudit("מושב התפנה בעקבות מחיקת בקשה", { seatId, requestId: request.id, fromOwner: owner });
        }
      }
    }
    
    await writeDB(db);
    await deleteStoredPaymentImage(request.paymentImage);
    addSeatAudit("בקשה נמחקה", { requestId: request.id, actor: "מנהל" });
    res.json({ success: true });
  } else {
    res.status(404).json({ error: "Not found" });
  }
});

// Move an approved customer from one seat to another while retaining the original request record.
app.post("/api/admin/seat/:seatId/move", adminAuth, async (req, res) => {
  const fromSeatId = req.params.seatId;
  const toSeatId = typeof req.body.toSeatId === "string" ? req.body.toSeatId : "";
  const db = await readDB();
  if (!SEAT_IDS.has(fromSeatId) || !SEAT_IDS.has(toSeatId) || fromSeatId === toSeatId) return res.status(400).json({ error: "בחירת המושבים אינה תקינה" });

  const fromSeat = db.seats[fromSeatId];
  const toSeat = db.seats[toSeatId];
  if (!fromSeat || fromSeat.status !== "taken" || !fromSeat.owner || (toSeat && toSeat.status !== "available")) return res.status(409).json({ error: "המושב החדש אינו פנוי או שהמושב המקורי אינו משויך ללקוח" });

  const owner = fromSeat.owner.trim();
  const request = db.requests.find((item) => item.status === "approved" && item.seats.includes(fromSeatId) && `${item.firstName} ${item.lastName}`.trim() === owner);
  if (!request) return res.status(409).json({ error: "לא נמצאה בקשה מאושרת עבור בעל המושב" });

  request.seats = request.seats.map((seat) => seat === fromSeatId ? toSeatId : seat);
  request.seatChanges ??= [];
  request.seatChanges.push({ seatId: fromSeatId, type: "transferred", timestamp: Date.now() });
  delete db.seats[fromSeatId];
  db.seats[toSeatId] = { status: "taken", owner };
  await writeDB(db);
  addSeatAudit("לקוח הועבר למושב אחר", { actor: "מנהל", requestId: request.id, seatId: toSeatId, fromOwner: `${fromSeatId}: ${owner}`, toOwner: `${toSeatId}: ${owner}` });
  res.json({ success: true });
});

// Edit the historic map. These records are also the source used by the public
// "did you sit here last year?" question.
app.post("/api/admin/last-year/seat/:seatId", adminAuth, async (req, res) => {
  const seatId = req.params.seatId;
  const owner = typeof req.body.owner === "string" ? req.body.owner.trim().replace(/\s+/g, " ") : "";
  if (!SEAT_IDS.has(seatId)) return res.status(400).json({ error: "המושב אינו תקין" });
  const db = await readDB();
  for (const user of db.lastYearUsers) user.seats = user.seats.filter(seat => seat !== seatId);
  db.lastYearUsers = db.lastYearUsers.filter(user => user.seats.length > 0);
  if (owner) {
    const [firstWord, ...remainingWords] = owner.split(" ");
    const firstName = remainingWords.length ? firstWord : "";
    const lastName = remainingWords.length ? remainingWords.join(" ") : firstWord;
    const normalizedOwner = owner.toLowerCase();
    let user = db.lastYearUsers.find(item => `${item.firstName} ${item.lastName}`.trim().toLowerCase() === normalizedOwner);
    if (!user) {
      user = { id: `manual-last-year-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, firstName, lastName, seats: [] };
      db.lastYearUsers.push(user);
    }
    user.seats.push(seatId);
  }
  await writeDB(db);
  addSeatAudit("מפת תשפ״ו נערכה", { actor: "מנהל", seatId, toOwner: owner || undefined });
  res.json({ success: true });
});

// Admin update specific seat (manual override)
app.post("/api/admin/seat/:seatId", adminAuth, async (req, res) => {
  const db = await readDB();
  const seatId = req.params.seatId;
  const { status, owner } = req.body; // status: "available" | "taken", owner: string
  if (!SEAT_IDS.has(seatId) || (status !== "available" && status !== "taken") || (status === "taken" && (!owner || typeof owner !== "string"))) {
    return res.status(400).json({ error: "עדכון המושב אינו תקין" });
  }
  const previousSeat = db.seats[seatId];
  const previousOwner = previousSeat?.status === "taken" ? previousSeat.owner?.trim() : "";
  const nextOwner = typeof owner === "string" ? owner.trim() : "";

  // Keep the original request accurate after a manual cancellation or owner change.
  if (previousOwner && (status === "available" || nextOwner !== previousOwner)) {
    const request = db.requests.find((item) =>
      item.status === "approved" &&
      item.seats.includes(seatId) &&
      `${item.firstName} ${item.lastName}`.trim() === previousOwner
    );

    if (request) {
      request.seats = request.seats.filter((item) => item !== seatId);
      request.seatChanges ??= [];
      request.seatChanges.push({
        seatId,
        type: status === "available" ? "released" : "transferred",
        timestamp: Date.now(),
      });
    }
  }
  
  if (status === "available") {
     delete db.seats[seatId];
  } else {
     db.seats[seatId] = { status: "taken", owner: nextOwner };
  }
  
  await writeDB(db);
  addSeatAudit(status === "available" ? "מושב פונה ידנית" : "בעלות מושב נערכה", { seatId, fromOwner: previousOwner || undefined, toOwner: status === "taken" ? nextOwner : undefined, actor: "מנהל" });
  res.json({ success: true });
});

app.get("/api/admin/export.xlsx", adminAuth, async (req, res) => {
  const { requests, auditLog } = getDashboardData();
  const escapeXml = (value: unknown) => String(value ?? "").replace(/[&<>\"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&apos;" })[char]!);
  const table = (title: string, headers: string[], rows: string[][]) => `<Worksheet ss:Name="${escapeXml(title)}"><Table><Row>${headers.map(header => `<Cell><Data ss:Type="String">${escapeXml(header)}</Data></Cell>`).join("")}</Row>${rows.map(row => `<Row>${row.map(value => `<Cell><Data ss:Type="String">${escapeXml(value)}</Data></Cell>`).join("")}</Row>`).join("")}</Table></Worksheet>`;
  const requestsRows = requests.map(item => [new Date(item.timestamp).toLocaleString("he-IL"), item.firstName, item.lastName, item.phone, item.requestedSeats.join(", "), item.seats.join(", "), item.status === "approved" ? "אושרה" : item.status === "rejected" ? "נדחתה" : "ממתינה", item.rejectionReason || ""]);
  const auditRows = auditLog.map(item => [new Date(item.timestamp).toLocaleString("he-IL"), item.action, item.seatId || "", item.fromOwner || "", item.toOwner || "", item.requestId || "", item.details || ""]);
  const workbook = `<?xml version="1.0" encoding="UTF-8"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">${table("בקשות", ["תאריך", "שם פרטי", "שם משפחה", "טלפון", "מושבים מבוקשים", "מושבים בפועל", "סטטוס", "סיבת דחייה"], requestsRows)}${table("יומן שיבוצים", ["תאריך", "פעולה", "מושב", "מבעלים", "לבעלים", "בקשה", "פירוט"], auditRows)}</Workbook>`;
  res.setHeader("Content-Type", "application/vnd.ms-excel; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=seat-management.xls");
  res.send(Buffer.from(workbook, "utf8"));
});

// --- VITE DEV / PROD SERVER ---

let applicationInitialized = false;

export async function initializeApplication() {
  // A Netlify function can stay warm after another function instance has
  // changed Firestore. Refresh on every invocation so the public map, the
  // dashboard and submitted forms all operate on the same current state.
  if (process.env.NETLIFY === "true" || process.env.VERCEL === "1") {
    await initDatabase();
    if (!applicationInitialized) {
      await migrateLegacyPaymentImages();
      applicationInitialized = true;
    }
    return;
  }
  if (applicationInitialized) return;
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  await initDatabase();
  await migrateLegacyPaymentImages();
  applicationInitialized = true;
}

async function startServer() {
  await initializeApplication();
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath, {
      setHeaders: (res) => res.setHeader("Cache-Control", "no-store")
    }));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

// When the file is imported by a Vercel Function its process starts in
// /var/task. Never call app.listen() there: Vercel owns the HTTP server.
const isServerlessRuntime = process.env.NETLIFY === "true" || process.env.VERCEL === "1" || process.cwd().startsWith("/var/task");
if (!isServerlessRuntime) startServer();

import fs from "node:fs/promises";
import path from "node:path";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getDashboardData, initDatabase } from "../database";

const keyPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || path.join(process.cwd(), "firebase-service-account.json");
const credentials = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || await fs.readFile(keyPath, "utf8"));

if (!getApps().length) initializeApp({ credential: cert(credentials) });

await initDatabase();
const source = getDashboardData();
const firestore = getFirestore();
firestore.settings({ ignoreUndefinedProperties: true });

const writes: Array<Promise<unknown>> = [];
for (const request of source.requests) writes.push(firestore.collection("requests").doc(request.id).set(request));
for (const [id, seat] of Object.entries(source.seats)) writes.push(firestore.collection("seats").doc(id).set(seat));
for (const user of source.lastYearUsers) writes.push(firestore.collection("lastYearUsers").doc(user.id).set(user));
for (const audit of source.auditLog) writes.push(firestore.collection("auditLog").doc(String(audit.id)).set(audit));
await Promise.all(writes);
await firestore.collection("system").doc("applicationState").set({
  seats: source.seats,
  requests: source.requests,
  lastYearUsers: source.lastYearUsers,
  updatedAt: Date.now(),
}, { merge: true });
await firestore.collection("system").doc("migration").set({
  importedAt: Date.now(),
  requests: source.requests.length,
  seats: Object.keys(source.seats).length,
  lastYearUsers: source.lastYearUsers.length,
  auditRecords: source.auditLog.length,
});

console.log(JSON.stringify({
  requests: source.requests.length,
  seats: Object.keys(source.seats).length,
  lastYearUsers: source.lastYearUsers.length,
  auditRecords: source.auditLog.length,
}));

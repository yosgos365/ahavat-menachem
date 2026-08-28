import type { Request, Response } from "express";

// Vercel calls this function for every /api/* request. The existing Express
// application remains the single implementation used locally and on Netlify.
export default async function handler(req: Request, res: Response) {
  process.env.VERCEL = "1";
  // Do not depend on the dashboard setting being propagated to a new
  // serverless instance: this API always persists through Firestore.
  process.env.USE_FIRESTORE = "true";
  // A tiny deployment probe used only to verify that Vercel is serving the
  // current function bundle before initializing the full application.
  if (req.url?.startsWith("/api/runtime-health")) {
    return res.status(200).json({ version: "2026-08-28-firestore", firestore: process.env.USE_FIRESTORE === "true" });
  }
  const { app, initializeApplication } = await import("../dist/server.cjs");
  await initializeApplication();
  return app(req, res);
}

export const config = {
  api: { bodyParser: false },
};

import type { Request, Response } from "express";
import { app, initializeApplication } from "../server";

// Vercel calls this function for every /api/* request. The existing Express
// application remains the single implementation used locally and on Netlify.
export default async function handler(req: Request, res: Response) {
  process.env.VERCEL = "1";
  await initializeApplication();
  return app(req, res);
}

export const config = {
  api: { bodyParser: false },
};

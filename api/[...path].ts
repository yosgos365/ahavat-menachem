import type { Request, Response } from "express";

// Vercel calls this function for every /api/* request. The existing Express
// application remains the single implementation used locally and on Netlify.
export default async function handler(req: Request, res: Response) {
  process.env.VERCEL = "1";
  const { app, initializeApplication } = await import("../server");
  await initializeApplication();
  app(req, res);
}

export const config = {
  api: { bodyParser: false },
};

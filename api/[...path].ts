import type { Request, Response } from "express";

// Vercel calls this function for every /api/* request. The existing Express
// application remains the single implementation used locally and on Netlify.
export default async function handler(req: Request, res: Response) {
  process.env.VERCEL = "1";
  // The Vercel build writes the shared Express server to dist/server.cjs.
  // Loading that explicit built file avoids an unresolved TypeScript source
  // import in the serverless runtime.
  const { app, initializeApplication } = await import("../dist/server.cjs");
  await initializeApplication();
  app(req, res);
}

export const config = {
  api: { bodyParser: false },
};

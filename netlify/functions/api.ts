import serverless from "serverless-http";

export const handler = async (event: any, context: any) => {
  process.env.NETLIFY = "true";
  const { app, initializeApplication } = await import("../../server");
  await initializeApplication();
  return serverless(app)(event, context);
};

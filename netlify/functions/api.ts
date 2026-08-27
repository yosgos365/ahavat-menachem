import serverless from "serverless-http";
import { app, initializeApplication } from "../../server";

const apiHandler = serverless(app);

export const handler = async (event: any, context: any) => {
  await initializeApplication();
  return apiHandler(event, context);
};

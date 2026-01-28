import { DEBUG_ENV, INFO_ENV, PRODUCTION_ENV } from "#constants/index.js";
import pino from "pino";

export const logger = pino({
  level: process.env.NODE_ENV === PRODUCTION_ENV ? INFO_ENV : DEBUG_ENV,
});

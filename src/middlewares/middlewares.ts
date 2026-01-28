import { logger } from '#share/logger.js';
import { RequestHandler } from 'express';

export const middleware: RequestHandler = (req, res) => {
  res.send('Hello World!');
  logger.info('Response sent');
};

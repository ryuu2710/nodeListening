import express, { Application, Request, Response } from "express";
import morgan from "morgan";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import cookieParser from "cookie-parser";
import BaseController from "./types/base/base.controller";
import { ErrorMiddleware } from "./middlewares/error.middleware";
import { logger } from "#share/logger.js";
import { rabbitMQService } from "#share/rabbitmq.js";

// import "reflect-metadata";

export default class App {
  public express: Application;
  public port: number;

  constructor(controllers: BaseController[], port: number) {
    this.express = express();
    this.port = port;
    this.initDatabaseConnection();
    this.initRedisConnection();
    // this.initRabbitMQConnection();
    this.initMiddleware();
    this.initControllers(controllers);
    this.initErrorHandler();
  }

  private initMiddleware(): void {
    this.express.use(cors());
    this.express.use(helmet());
    this.express.use(morgan("dev"));
    this.express.use(compression());
    this.express.use(cookieParser());
    // this.express.use(express.json());
    this.express.use(express.json({ limit: "50mb" }));
    this.express.use(express.urlencoded({ limit: "50mb", extended: true }));
  }

  private initDatabaseConnection(): void {}

  private async initRedisConnection() {}

  private async initRabbitMQConnection(): Promise<void> {
    try {
      await rabbitMQService.connect();

      // turn on the "headphones" to test if they are receiving data.
      await rabbitMQService.startLocalConsumerForTesting();

      // send a test message to test the outgoing stream connection.
      await rabbitMQService.publishScrapingData({
        test_message: "Hello RabbitMQ",
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error("❌ Khởi tạo RabbitMQ thất bại:", error as any);
    }
  }

  private initErrorHandler(): void {
    this.express.use(ErrorMiddleware.handleError);
  }

  private initControllers(controllers: BaseController[]): void {
    controllers.map((controller) => {
      this.express.use(`/api/${process.env.API_VERSION_1}`, controller.router);
    });
  }

  public listen() {
    this.express.listen(this.port, () => {
      logger.info(`Server connected to ${process.env.HOST}:${this.port} `);
    });
  }
}

import express, { Application, Request, Response } from 'express';
import morgan from "morgan";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import cookieParser from "cookie-parser";
import BaseController from "./types/base/base.controller";
import { ErrorMiddleware } from './middlewares/error.middleware';

// import "reflect-metadata";

export default class App {
    public express: Application;
    public port: number;

    constructor(controllers: BaseController[], port: number) {
        this.express = express();
        this.port = port
        this.initDatabaseConnection();
        this.initRedisConnection();
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
        this.express.use(express.json({ limit: '50mb' }));
        this.express.use(express.urlencoded({ limit: '50mb', extended: true }));
    }

    private initDatabaseConnection(): void {
      
    }

    private async initRedisConnection() {
        
    }

  private initErrorHandler(): void {
        this.express.use(ErrorMiddleware.handleError)
    }

    private initControllers(controllers: BaseController[]): void {
        controllers.map((controller) => {
          this.express.use(`/api/${process.env.API_VERSION_1}`, controller.router)
        })
    }

    public listen() {
        this.express.listen(this.port, () => {
            console.log(`Server connected to ${process.env.HOST}:${this.port} `)
        })
    }
}

import BaseController from "#types/base/base.controller.js";
import { NextFunction, Request, Response, Router } from "express";
import { inject, injectable } from "tsyringe";
import KemonoScraperService from "../services/kemono.service";

@injectable()
export default class KemonoController implements BaseController {
  public readonly path: string = "/kemono";
  public readonly router: Router = Router();

  constructor(@inject(KemonoScraperService) private readonly kemonoScraperService: KemonoScraperService) {
    this.initRoutes();
  }

  private initRoutes = (): void => {
    this.router.route(`${this.path}/scrape`).post(this.scrapeHentaiImages);
  };

  private scrapeHentaiImages = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const { url, path } = req.body;
    await this.kemonoScraperService.scrapeHentaiImages(path, url)
  }
}

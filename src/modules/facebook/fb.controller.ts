import BaseController from "#types/base/base.controller.js";
import { NextFunction, Request, Response, Router } from "express";
import { inject, injectable } from "tsyringe";
import FbScraperService from "./fb.service";
import { ScrapeRequest, ScrapeResultGenParams } from "#types/index.js";
import { getTokenFromRequest } from "#share/auth.js";
import { buildFbGroupSearchUrl } from "./fb.builder";
import { SocialFbMention } from "./fb.types";
import { BrandInsightService } from "#modules/metrics/brand.service.js";
import { BrandInsightReport } from "#modules/metrics/brand.type.js";

@injectable()
export default class FbController implements BaseController {
  public readonly path: string = "/facebook";
  public readonly router: Router = Router();

  constructor(
    @inject(FbScraperService)
    private readonly fbScraperService: FbScraperService,
    @inject(BrandInsightService)
    private readonly brandInsightService: BrandInsightService,
  ) {
    this.initRoutes();
  }

  private initRoutes = (): void => {
    this.router
      .route(`${this.path}/scrape/group/comments`)
      .post(this.scrapeCommentsByGroupIdAndPostId);

    this.router
      .route(`${this.path}/scrape/fanpage/comments`)
      .post(this.scrapeCommentsOfPostInFanpageByPostId);

    this.router
      .route(`${this.path}/scrape/fanpage`)
      .post(this.scrapeFanpageFeed);

    this.router.route(`${this.path}/scrape/build-url`).get(this.buildURL);

    this.router
      .route(`${this.path}/brand-insight`)
      .post(this.generateBrandInsightReport);

    this.router
      .route(`${this.path}/scrape/:projectId`)
      .post(this.scrapeFacebookGroup);

    this.router
      .route(`${this.path}/scrape/fanpage/reel/:postId/comments`)
      .post(this.scrapeCommentsOfReelInFanpageByPostId);
  };

  private scrapeFanpageFeed = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { pageUrl, sinceDate } = req.body;
      if (!pageUrl) {
        res.status(400).json({ message: "Missing 'pageUrl' in body" });
        return;
      }

      if (!sinceDate) {
        res.status(400).json({ message: "Missing 'sinceDate' in body (YYYY-MM-DD)" });
        return;
      }

      const parsedSinceDate = new Date(sinceDate);
      if (isNaN(parsedSinceDate.getTime())) {
        res.status(400).json({ message: "Invalid 'sinceDate' format" });
        return;
      }

      console.log(`Start scraping Fanpage: ${pageUrl} since ${parsedSinceDate.toISOString()}`);

      const posts = await this.fbScraperService.scrapeFanpagePosts(pageUrl, parsedSinceDate);
      res.status(200).json({
        success: true,
        count: posts.length,
        filter_date: parsedSinceDate.toISOString(),
        data: posts,
      });

    } catch (error) {
      console.error("🔥 Error in scrapeFanpageFeed controller:", error);
      next(error);
    }
  };

  private scrapeCommentsByGroupIdAndPostId = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    // https://www.facebook.com/groups/reviewcactiemcaphesaigon/posts/3401776906795134/
    const {postURL} = req.body;
    const data = await this.fbScraperService.scrapeCommentsOfPostInGroup(postURL);
    res.status(200).json(data);
  };

  private scrapeCommentsOfPostInFanpageByPostId = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    // https://www.facebook.com/groups/reviewcactiemcaphesaigon/posts/3401776906795134/
    const {postURL} = req.body;
    const data = await this.fbScraperService.scrapeCommentsOfPostInFanpage(postURL);
    res.status(200).json(data);
  };

  private scrapeCommentsOfReelInFanpageByPostId = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    // https://www.facebook.com/reel/879156304830814/
    const {postURL} = req.body;
    const data = await this.fbScraperService.scrapeCommentsOfReelInFanpage(postURL);
    res.status(200).json({count: data.length, data});
  };

  // https://www.facebook.com/Zalopay

  private scrapeFacebookGroup = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const { projectId } = req.params;
    const { groupId, scrollTimes, keyword, year } = req.body as ScrapeRequest;
    // const token: string = getTokenFromRequest(req)

    if (!groupId) {
      res.status(400).json({ message: "Lack of parameter 'groupId'" });
      return;
    }

    try {
      console.log(`Receive scraping requirement for group: ${groupId}`);
      // const result = await this.fbScraperService.scrapeGroupPosts(projectId, groupId, scrollTimes, token);
      const result: ScrapeResultGenParams<SocialFbMention[]> =
        await this.fbScraperService.scrapeGroupPostsByFilterParams(
          "",
          groupId,
          scrollTimes,
          keyword,
          year,
        );

      res.status(200).json({
        message: `Successfully collect ${result.count} posts from group ${groupId}.`,
        ...result,
      });
    } catch (error) {
      console.error(
        "Error for request process handling during scraping:",
        error,
      );
      res.status(500).json({
        message: "Occured unexpected error during scraping.",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  private generateBrandInsightReport = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const config = req.body;
      if (
        !config.brandKeyword ||
        !config.targetGroups ||
        config.targetGroups.length === 0
      ) {
        res.status(400).json({
          message: "Invalid Config. Require 'brandKeyword' and 'targetGroups'.",
        });
        return;
      }

      console.log(
        `📊 Generating Brand Insight Report for: ${config.brandKeyword}`,
      );

      const report: BrandInsightReport | null =
        await this.brandInsightService.generateReport(config);

      res.status(200).json({
        message: "Brand Insight Report generated successfully.",
        data: report,
      });
    } catch (error) {
      console.error("Error generating brand insight report:", error);
      res.status(500).json({
        message: "Failed to generate report.",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  private buildURL(req: Request, res: Response, next: NextFunction) {
    res
      .status(200)
      .json(buildFbGroupSearchUrl("1166454660883635", "xây kênh", 2026));
  }
}

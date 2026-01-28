import { Request, Response, NextFunction, Router } from "express";
import { inject, injectable } from "tsyringe";
import { FbWorkerService } from "./fb-worker.service";
import { SocialFbMention } from "./fb.types";

@injectable()
export default class FbWorkerController {
  public readonly path: string = "/facebook/workers"; // Route riêng cho worker
  public readonly router: Router = Router();

  constructor(@inject(FbWorkerService) private workerService: FbWorkerService) {
    this.initRoutes();
  }

  private initRoutes = (): void => {
    this.router.post(`${this.path}/start-campaign`, this.startCampaign);

    // 1. Trigger Fanpage (Owned + Paid Media)
    this.router.post(`${this.path}/fanpage-batch`, this.runFanpageBatchWorker);

    // 2. Trigger Group/Keyword (Earned Media)
    this.router.post(`${this.path}/group-batch`, this.runGroupBatchWorker);

    // 3. Trigger Comment
    this.router.post(`${this.path}/comment-batch`, this.runCommentBatchWorker);
  };

  // API này user gọi khi bấm nút "Start"
  public startCampaign = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      console.log(req.body);
      const { config } = req.body;

      console.log(`🕹️ [START] Campaign: ${config.campaignName}`);

      // Worker A (Fanpage)
      const aggerationFanpagePosts: SocialFbMention[] =
        await this.workerService.executeFanpageBatch(
          config.sources.ownedPages,
          config.duration.startDate,
          "OWNED",
        );
      const aggerationKolPosts: SocialFbMention[] = await this.workerService.executeFanpageBatch(
        config.sources.kolPages,
        config.duration.startDate,
        "PAID"
      );

      // Worker B (Group) - Chạy ngầm song song với A
      this.workerService.executeGroupBatch(
        config.sources.keywords,
        config.sources.communityGroups,
        config.duration.startDate,
      );

      // LƯU Ý: KHÔNG gọi Worker C ở đây!
      // Worker C sẽ được gọi BÊN TRONG Worker A và B khi tìm thấy bài viết.

      const totalResult = {
          message: `Đã thu thập được ${aggerationFanpagePosts?.length} bài đăng từ Owned, ${aggerationKolPosts?.length} bài đăng từ KOLS`,
          campaign: config.campaignName,
          totalCollected: aggerationFanpagePosts.length + aggerationKolPosts.length,
          ownedPostsCollected: aggerationFanpagePosts.length,
          paidPostsCollected: aggerationKolPosts.length,
          breakdown: {
              owned: aggerationFanpagePosts.length,
              paid: aggerationKolPosts.length
          },
          data: {
            ownedPosts: aggerationFanpagePosts,
            paidPosts: aggerationKolPosts
          }
      };

      // Trả về JSON cho bro xem ngay trên Postman
      res.status(200).json(totalResult);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Worker A: Xử lý Fanpages
   * Body: { pages: [{url, name}], sinceDate: "2024-11-01" }
   */
  private runFanpageBatchWorker = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { pages, sinceDate } = req.body;
      console.log(
        `[🕹️ DISPATCHER] Received SIGNAL to scrape ${pages.length} Fanpages.`,
      );

      // Fire & Forget: Gọi service chạy ngầm, không await để tránh timeout request
      // this.workerService.executeFanpageBatch(pages, new Date(sinceDate));

      res.status(202).json({
        status: "ACCEPTED",
        message: "Fanpage Batch Job has started in background.",
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Worker B: Xử lý Group & Keywords
   * Body: { keywords: ["ZaloPay", "Lắc Xì"], groupUrls: [...], sinceDate: "..." }
   */
  private runGroupBatchWorker = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { keywords, groupUrls, sinceDate } = req.body;
      console.log(`[🕹️ DISPATCHER] Received SIGNAL for Earned Media.`);

      this.workerService.executeGroupBatch(
        keywords,
        groupUrls,
        new Date(sinceDate),
      );

      res.status(202).json({ message: "Group Batch Job started." });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Worker C: Xử lý Comments
   * Body: { postUrls: ["url1", "url2"] }
   */
  private runCommentBatchWorker = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { postUrls } = req.body;
      this.workerService.executeCommentBatchInFanpage(postUrls);
      res.status(202).json({ message: "Comment Batch Job started." });
    } catch (error) {
      next(error);
    }
  };
}

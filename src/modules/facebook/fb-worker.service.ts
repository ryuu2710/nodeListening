import { inject, injectable } from "tsyringe";
import FbScraperService from "./fb.service";
import { SocialFbComment, SocialFbMention } from "./fb.types";
import { getMyCustomRemoteBrowser } from "#share/browser.js";
import { logger } from "#share/logger.js";

@injectable()
export class FbWorkerService {
  constructor(
    @inject(FbScraperService) private fbScraperService: FbScraperService,
  ) {}

  // A. FANPAGE WORKER
  public async executeFanpageBatch(
    pages: any[],
    sinceDate: Date,
    category: "OWNED" | "PAID",
  ): Promise<SocialFbMention[]> {
    logger.info(`[WORKER A] STARTING FANPAGE BATCH...`);
    const masterList: SocialFbMention[] = [];
    for (const page of pages) {
      logger.info(`[Processing] Page: ${page.name}`);
      try {
        logger.info(`Calling scrapeFanpagePosts(${page.url})...`);

        const parsedSinceDate = new Date(sinceDate);
        if (isNaN(parsedSinceDate.getTime())) {
          return [];
        }

        const rawData: SocialFbMention[] =
          await this.fbScraperService.scrapeFanpagePosts(
            page.url,
            parsedSinceDate,
          );
        if (rawData.length === 0) {
          logger.info(`No posts found for ${page.name}`);
          continue;
        }
        let enrichedPosts = rawData.map((data) => ({
          ...data,
          sourceInfo: {
            name: page.name,
            url: page.url,
            category,
            platform: "FACEBOOK",
          },
          crawledAt: new Date().toISOString(),
          // comments_data: [],
        }));
        const listPostsNeededComments = enrichedPosts.filter(
          (p) => p.stats.comments > 0,
        );

        if (listPostsNeededComments.length > 0) {
          logger.info(
            `Triggering Worker C for ${listPostsNeededComments.length} posts...`,
          );
          const commentsMap = await this.executeCommentBatchInFanpage(
            listPostsNeededComments,
          );

          // assign the comment back to the post
          enrichedPosts = enrichedPosts.map((post) => {
            if (commentsMap[post.id]) {
              return { ...post, commentsData: commentsMap[post.id] };
            }
            return post;
          });
        }
        logger.info(
          `Collected ${enrichedPosts.length} posts from page ${page.name}.`,
        );
        masterList.push(...(enrichedPosts as SocialFbMention[]));
      } catch (error) {
        console.error(`[ERROR] Failed to scrape page ${page.name}:`, error);
      }
    }
    logger.info(`[WORKER A] FINISHED.`);
    return masterList;
  }

  // B. GROUP/SEARCH WORKER
  public async executeGroupBatch(
    keywords: string[],
    groupUrls: string[],
    sinceDate: Date,
  ) {
    
  }

  // C. COMMENT WORKER
  public async executeCommentBatchInFanpage(
    posts: SocialFbMention[],
  ): Promise<Record<string, any[]>> {
    const results: Record<string, any[]> = {};

    for (const post of posts) {
      try {
        const { type, finalUrl } = await this.resolveUrlType(post.url);
        let comments: SocialFbComment[] = [];

        if (type === 'REEL') {
            comments = await this.fbScraperService.scrapeCommentsOfReelInFanpage(finalUrl);
        } else {
            comments = await this.fbScraperService.scrapeCommentsOfPostInFanpage(finalUrl);
        }

        results[post.id] = comments;

      } catch (e) {
        console.error(
          `Failed to scrape comments for post ${post.id}`, e
        );
        results[post.id] = [];
      }
    }
    return results;
  }

  // Thêm vào FbWorkerService.ts

  /**
   * Hàm kiểm tra xem URL này rốt cuộc là Post thường hay Reel
   * Return: 'REEL' | 'POST' và URL chuẩn sau khi redirect
   */
  private async resolveUrlType(
    rawUrl: string,
  ): Promise<{ type: "REEL" | "POST"; finalUrl: string }> {
    if (rawUrl.includes("/reel/")) {
      return { type: "REEL", finalUrl: rawUrl };
    }

    let browser = null;
    try {
      browser = await getMyCustomRemoteBrowser();
      const page = await browser.newPage();
      await page.setRequestInterception(true);
      page.on("request", (req) => {
        if (
          ["image", "stylesheet", "font", "media"].includes(req.resourceType())
        ) {
          req.abort();
        } else {
          req.continue();
        }
      });
      await page.goto(rawUrl, {
        waitUntil: "domcontentloaded",
        timeout: 15000,
      });

      try {
        await page.waitForFunction(
          () => {
            return window.location.href.includes("/reel/");
          },
          { timeout: 3000 },
        );
      } catch (e) {
      }

      const finalUrl = page.url();
      await page.close();

      if (finalUrl.includes("/reel/")) {
        return { type: "REEL", finalUrl };
      }

      return { type: "POST", finalUrl };
    } catch (error) {
      if (browser) await browser.close();
      return { type: "POST", finalUrl: rawUrl };
    } finally {
      if (browser) await browser.disconnect();
    }
  }
}

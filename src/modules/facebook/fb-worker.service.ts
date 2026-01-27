import { inject, injectable } from "tsyringe";
import FbScraperService from "./fb.service";
import { SocialFbComment, SocialFbMention } from "./fb.types";

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
    console.log(`\n[WORKER A] STARTING FANPAGE BATCH...`);
    const masterList: SocialFbMention[] = [];
    for (const page of pages) {
      console.log(`[Processing] Page: ${page.name}`);
      try {
        console.log(`Calling scrapeFanpagePosts(${page.url})...`);

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
          console.log(`No posts found for ${page.name}`);
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
          comments_data: [],
        }));
        const listPostsNeededComments = enrichedPosts.filter(
          (p) => p.stats.comments > 0,
        );

        if (listPostsNeededComments.length > 0) {
          console.log(
            `Triggering Worker C for ${listPostsNeededComments.length} posts...`,
          );
          const commentsMap = await this.executeCommentBatchInFanpage(listPostsNeededComments);

          // Gắn comment quay ngược lại vào post
          enrichedPosts = enrichedPosts.map(post => {
              if (commentsMap[post.id]) {
                  return { ...post, commentsData: commentsMap[post.id] };
              }
              return post;
          });
        }
        console.log(
          `Collected ${enrichedPosts.length} posts from page ${page.name}.`,
        );
        masterList.push(...enrichedPosts as SocialFbMention[]);
      } catch (error) {
        console.error(`[ERROR] Failed to scrape page ${page.name}:`, error);
      }
    }
    console.log(`[WORKER A] FINISHED.\n`);
    return masterList;
  }

  // B. GROUP/SEARCH WORKER
  public async executeGroupBatch(
    keywords: string[],
    groupUrls: string[],
    sinceDate: Date,
  ) {
    console.log(`\n🚀 [WORKER B] STARTING EARNED MEDIA BATCH...`);

    // Phase 1: Search Keywords
    for (const keyword of keywords) {
      console.log(`   🔸 [Processing] Keyword: "${keyword}"`);
      try {
        console.log(
          `      -> 📡 Calling scrapeGroupPostsByFilterParams(${keyword})...`,
        );
        // await this.fbScraperService.scrapeGroupPostsByFilterParams(..., keyword, ...);
        console.log(`      -> ✅ Found discussion posts.`);
      } catch (e) {
        console.error(`      ❌ [ERROR] Keyword ${keyword} failed.`);
      }
    }

    // Phase 2: Crawl Group Feed (Fan Cứng Group)
    for (const groupUrl of groupUrls) {
      console.log(`   🔸 [Processing] Group Feed: ${groupUrl}`);
      try {
        console.log(`      -> 📡 Calling scrapeGroupFeed(${groupUrl})...`); // Hàm này bro sẽ cần viết thêm hoặc tái sử dụng logic
        console.log(`      -> ✅ Collected group posts.`);
      } catch (e) {
        console.error(`      ❌ [ERROR] Group ${groupUrl} failed.`);
      }
    }
    console.log(`✅ [WORKER B] FINISHED.\n`);
  }

  // C. COMMENT WORKER
  public async executeCommentBatchInFanpage(
    posts: SocialFbMention[],
  ): Promise<Record<string, any[]>> {
    const results: Record<string, any[]> = {};

    for (const post of posts) {
      try {
        console.log(`Scraping comments for post: ${post.id}`);
        console.log("Post URL truyền vào comments: ", post.url);
        const comments: SocialFbComment[] = await this.fbScraperService.scrapeCommentsOfPostInFanpage(
          post.url
        );
        results[post.id] = comments;
        console.log(`Found ${comments.length} comments.`);
      } catch (e) {
        console.error(
          `            -> ❌ Failed to scrape comments for post ${post.id}`,
        );
        results[post.id] = [];
      }
    }
    return results;
  }
}

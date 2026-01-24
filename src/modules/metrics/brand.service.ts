import FbScraperService from "#modules/facebook/fb.service.js";
import { inject, injectable } from "tsyringe";
import { BrandInsightConfig, BrandInsightReport } from "./brand.type";
import { SocialFbMention } from "#modules/facebook/fb.types.js";
import pino from "pino";
import { DEBUG_ENV, INFO_ENV, PRODUCTION_ENV } from "#constants/index.js";
import { ScrapeResultGenParams } from "#types/index.js";

const logger = pino({
  level: process.env.NODE_ENV === PRODUCTION_ENV ? INFO_ENV : DEBUG_ENV,
});

@injectable()
export class BrandInsightService {
  constructor(@inject(FbScraperService) private readonly fbScraper: FbScraperService) {}

  public async generateReport(config: BrandInsightConfig): Promise<BrandInsightReport | null> {
    const allPosts: SocialFbMention[] = [];

    logger.info(`Analyzing brand: ${config.brandKeyword}...`);

    for (const group of config.targetGroups) {
      const result: ScrapeResultGenParams<SocialFbMention[]> = await this.fbScraper.scrapeGroupPostsByFilterParams(
        "123456",
        group.id,
        100,
        config.brandKeyword,
        config.year,
      );

      const taggedPosts = result.data.map((d) => ({ ...d, type: "BRAND", groupName: group.name }));
      allPosts.push(...taggedPosts);
    }

    for (const compKw of config.competitorKeywords) {
      for (const group of config.targetGroups) {
        const result: ScrapeResultGenParams<SocialFbMention[]> = await this.fbScraper.scrapeGroupPostsByFilterParams(
          config.projectId,
          group.id,
          20,
          compKw,
          config.year,
        );

        const taggedPosts = result.data.map((d) => ({...d, type: "COMPETITOR", competitorName: compKw, groupName: group.name}));
        allPosts.push(...taggedPosts);
      }
    }

    return this.calculateMetrics(allPosts);
  }

  private calculateMetrics(posts: any[]): BrandInsightReport {
    const brandPosts = posts.filter((p) => p.type === "BRAND");
    const compPosts = posts.filter((p) => p.type === "COMPETITOR");

    // Metric 1: Share of Voice
    const brandVol = brandPosts.length;
    const compVol = compPosts.length;
    const total = brandVol + compVol;

    // Metric 2: Sentiment = (Like + Love) - (Angry + Sad)
    const calculateScore = (postList: any[]) => {
      let totalScore = 0;
      postList.forEach((post) => {
        const reactions = post.stats?.reaction_breakdown || {};
        const positive = (reactions["like"] || 0) + (reactions["love"] || 0) + (reactions["care"] || 0);
        const negative = (reactions["angry"] || 0) + (reactions["sad"] || 0);
        totalScore += positive - negative;
      });
      return totalScore;
    };

    return {
      shareOfVoice: {
        brandVolume: brandVol,
        competitorVolume: compVol,
        totalVolume: total,
        sovPercentage: total > 0 ? parseFloat(((brandVol / total) * 100).toFixed(1)) : 0,
      },
      sentimentHealth: {
        brandScore: calculateScore(brandPosts),
        competitorScore: calculateScore(compPosts),
      },
      rawPosts: posts,
    };
  }
}

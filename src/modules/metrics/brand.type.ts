import { SocialFbMention } from "#modules/facebook/fb.types.js";

export interface BrandInsightConfig {
  projectId: string;
  targetGroups: { id: string; name: string }[];
  brandKeyword: string;
  competitorKeywords: string[];
  year: number | 0;
}

export interface BrandInsightReport {
  shareOfVoice: {
    brandVolume: number;      // number of my posts
    competitorVolume: number; // number of competitor posts
    totalVolume: number;
    sovPercentage: number;    // % its market share
  };
  sentimentHealth: {
    brandScore: number;       // positive brand score
    competitorScore: number;  // positive competitor score
  };
  rawPosts: SocialFbMention[];
}

export interface SocialFbMention {
  id: string;
  url: string;
  content: string;
  author: {
    id: string;
    name: string;
    isAnonymous: boolean;
  };
  stats: {
    likes: number;
    comments: number;
    shares: number;
    reactionBreakdown: Record<string, number>; // { like: 10, love: 5 }
  };
  createdAtTs: number;
  // Các field metadata debug nếu cần
  scrapeSessionId?: string; 
}

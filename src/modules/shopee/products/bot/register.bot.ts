// container.ts
import { container } from "tsyringe";
import { BOT_SCRAPER_FACTORY_TOKEN, BotScraper, BotScraperFactory } from "./abstract.bot";
import ShopeeBotScraper from "./product.bot";



// Khi inject BotScraper, tsyringe sẽ khởi ShopeeBotScraper
container.register<BotScraperFactory>(BOT_SCRAPER_FACTORY_TOKEN, {
  useFactory: () => {
    return (url: string) => new ShopeeBotScraper(url);
  }
});

// container.registerSingleton<BotScraper>(BOT_SCRAPER_TOKEN, ShopeeBotScraper);
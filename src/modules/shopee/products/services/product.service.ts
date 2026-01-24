// product.service.ts
import { inject, injectable } from 'tsyringe';
import { BOT_SCRAPER_FACTORY_TOKEN, BotScraperFactory } from '../bot/abstract.bot';

@injectable()
export default class ShopeeProductService {
  constructor(
    @inject(BOT_SCRAPER_FACTORY_TOKEN)
    private readonly scraperFactory: BotScraperFactory
  ) {}

  public async collectRecommendedProducts(url: string) {
    const scraper = this.scraperFactory(url);       // đây là instance với property url
    return scraper.scraperData();                    // scraper.activateBot(url) + scraperData()
  }
}

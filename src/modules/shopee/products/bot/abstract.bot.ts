import { Browser } from "puppeteer";
import { Platforms } from "../../../../constants";
import { InjectionToken } from "tsyringe";


export type BotScraperFactory = (url: string) => BotScraper;

export const BOT_SCRAPER_FACTORY_TOKEN: InjectionToken<BotScraperFactory> =
    Symbol('BotScraperFactory');

export abstract class BotScraper {
    constructor(protected platform: Platforms) { }

    // Abstract method declaration: No implementation, subclasses must implement this
    public abstract activateBot(): Promise<{ browser: Browser; headers: Record<string, string> }>;
    public abstract scraperData(): Promise<any>;
    public abstract getCurrentPlatform(): Platforms;
}

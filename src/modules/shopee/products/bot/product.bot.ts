import { Browser, Page } from "puppeteer"; // puppeteer không cần import trực tiếp nếu puppeteerExtra đã đủ
import { BotScraper } from "./abstract.bot";
import { HEADLESS_STATE_MANAGEMENT, Platforms } from "../../../../constants";
import { injectable } from "tsyringe";
import puppeteerExtra from 'puppeteer-extra'
import fs from 'fs';
import { ShopeeRecommendationPostData, ShopeeRequestHeaders } from "../../../../types/shopee";
import snakecaseKeys from 'snakecase-keys';
import StealthPlugin from 'puppeteer-extra-plugin-stealth'

puppeteerExtra.use(StealthPlugin());

// import path from 'path'; // Nên dùng path để xử lý đường dẫn file an toàn hơn

// 1) Enable stealth
// puppeteerExtra.use(StealthPlugin());

@injectable()
export default class ShopeeBotScraper extends BotScraper {
    private page!: Page;
    private capturedPostData!: string | Promise<string>;

    constructor(private readonly url: string) {
        super(Platforms.SHOPEE);
    }

    /**
     * Kết nối, trigger request để capture headers,
     * rồi return browser và headers đã parse + patched
     */
    public async activateBot(): Promise<{
        browser: Browser;
        headers: Record<string, string>;
        postData: ShopeeRecommendationPostData;
    }> {

        const browser = await puppeteerExtra.connect({
            browserURL: `http://${process.env.CHROME_PROFILE_DEVTOOLS_HOST}:${process.env.CHROME_PROFILE_DEVTOOLS_PORT
                }`,
            defaultViewport: null,
        });

        this.page = await browser.newPage();
        const client = await this.page.target().createCDPSession();
        await client.send('Network.enable');

        let captured: Record<string, string> = {};

        client.on('Network.requestWillBeSent', (evt) => {
            const { requestId, request } = evt;
            if (
                request.url.includes('/api/v4/shop/rcmd_items') &&
                request.method === 'POST'
            ) {
                captured = request.headers as Record<string, string>;

                this.capturedPostData =
                    request.postData ??
                    // fallback qua CDP call nếu cần
                    (async () => {
                        const resp = await client.send('Network.getRequestPostData', { requestId });
                        return resp.postData || '';
                    })();

                fs.writeFileSync(
                    'shopee_headers_v3.json',
                    JSON.stringify(captured, null, 2),
                    'utf-8'
                )

                fs.writeFileSync(
                    'shopee_body_v3.json',
                    JSON.stringify(this.capturedPostData, null, 2),
                    'utf-8'
                )
            }
        });

        const parsedDynamicHeaders: Record<string, string> = JSON.parse(
            fs.readFileSync('shopee_headers_v3.json', 'utf-8')
        )

        const parsedDynamicBody: string = JSON.parse(
            fs.readFileSync('shopee_body_v3.json', 'utf-8')
        )

        await this.page.goto(this.url, {
            timeout: 30_000,
            waitUntil: 'networkidle0',
        });

        // console.log("Alolo")

        // const raw = typeof this.capturedPostData === 'string'
        //     ? this.capturedPostData
        //     : await this.capturedPostData;

        const postData: ShopeeRecommendationPostData = JSON.parse(parsedDynamicBody);

        console.log("\n\n\n\nPosted data")
        console.log(postData)

        // nếu bạn vẫn ghi file, vẫn có thể dùng fs.readFileSync(...)
        // ở đây mình patch luôn 3 field optional
        const secFetchDest = captured['sec-fetch-dest'] ?? 'empty';
        const secFetchMode = captured['sec-fetch-mode'] ?? 'cors';
        const secFetchSite = captured['sec-fetch-site'] ?? 'same-site';

        const headers: Record<string, string> = {
            ...parsedDynamicHeaders,
            'sec-fetch-dest': secFetchDest,
            'sec-fetch-mode': secFetchMode,
            'sec-fetch-site': secFetchSite,
        };

        return { browser, headers, postData };
    }

    /**
     * Lấy data thật sự: gọi activateBot(),
     * chạy page.evaluate với headers, đóng browser,
     * rồi trả về JSON response
     */
    public async scraperData(): Promise<any> {
        const { browser, headers, postData } = await this.activateBot();

        console.log("\n\n\nHeaders data")
        console.log(headers);
        console.log(JSON.stringify(postData))

        const result = await this.page.evaluate(
            async (hdrs: Record<string, string>) => {
                const body = {
                    bundle: 'shop_page_category_tab_main',
                    item_id: 5553355607,
                    shop_id: 73624532,
                    limit: 30,
                    offset: 0,
                    upstream: 'pdp',
                    sort_type: 1,
                    item_card_use_scene: 'category_product_list_popular',
                    is_insert_new_arrival: false
                }

                console.log(postData, body)
                const resp = await fetch(
                    'https://shopee.vn/api/v4/shop/rcmd_items',
                    {
                        method: 'POST',
                        headers: hdrs,
                        body: JSON.stringify(postData),
                        credentials: 'include',
                    }
                );
                console.log(resp)
                return resp.json();
            },
            headers
        );

        console.log(result)

        await browser.disconnect();
        return result;
    }

    public getCurrentPlatform(): Platforms {
        return this.platform;
    }
}

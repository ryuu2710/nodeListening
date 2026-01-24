import BaseController from "#types/base/base.controller.js";
import { NextFunction, Request, Response, Router } from "express";
import { inject, injectable } from "tsyringe";
import AmazonScraperService from "../services/amazon.service";
import { AmazonScrapeResultParams, AmazonProductDTO, ScrapeResultGenParams } from "#types/index.js";
import axios from "axios";
import { getTokenFromRequest } from "#share/auth.js";

const SPREADSHEET_ID = "1MSui6cXsAN46zMZbUH_lYVpkllZA7TN4_B5PiEF52W0";

@injectable()
export default class AmazonController implements BaseController {
  public readonly path: string = "/amazon";
  public readonly router: Router = Router();

  constructor(@inject(AmazonScraperService) private readonly amazonScraperService: AmazonScraperService) {
    this.initRoutes();
  }

  private initRoutes = (): void => {
    this.router.route(`${this.path}/scrape/:projectId`).post(this.scrapeAmazonProductDetails);
    this.router.route(`${this.path}/scrape/:projectId/parallel`).post(this.scrapeAggregateProductsBySearchKw);
    this.router.route(`${this.path}/excels/export`).post(this.exportToGgSheet);
  };

  private exportToGgSheet = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      console.log("Đã vào hàm testExcelExport");

      // 1. Kiểm tra body trước
      if (!req.body) {
        // Trả về lỗi 400 nếu body không có 'data'
        res.status(400).json({
          success: false,
          message: 'Lỗi: Request body phải chứa trường "data" là một mảng.',
        });
      }

      // 2. Bây giờ destructuring mới an toàn
      const { data } = req.body as ExcelTestBodyDto;
      console.log(`Nhận yêu cầu xuất Google Sheet cho ${data.length} sản phẩm...`);

      // 3. Gọi hàm service
      await this.amazonScraperService.appendDataToGoogleSheet(data);

      console.log(`Ghi Google Sheet thành công!`);

      res.status(200).json({
        success: true,
        message: 'Đã ghi dữ liệu vào Google Sheet thành công!',
        spreadsheetId: SPREADSHEET_ID
      });
    } catch (error) {
      console.log({ message: "Lỗi khi xuất file Excel", error });
      next(error);
    }
  };

  private scrapeAmazonProductDetails = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { projectId } = req.params;
      const { url } = req.body;

      if (!projectId) {
        res.status(400).json({ message: "Vui lòng cung cấp projectId." });
        return;
      }

      if (!url) {
        res.status(400).json({ message: "Vui lòng cung cấp đường dẫn URL của website." });
        return;
      }

      // let data: AmazonScrapeResultParams = await this.amazonScraperService.scrapeAmazonProductDetails(url);
      // res.status(200).json(data);
      res.status(200).json({});
    } catch (error) {
      console.log("Lỗi scrape amazon: ", error);
    }
  };

  private scrapeAggregateProductsBySearchKw = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const { keyword, maxPages } = req.body;
    const token: string = getTokenFromRequest(req)
    
    if (!keyword || typeof keyword !== 'string' || keyword.trim() === '') {
      res.status(400).json({ 
        success: false, 
        message: "Validation Error: 'keyword' is required and must be a non-empty string."
      });
      return;
    }

    // const safeMaxPages: number = maxPages && Number.isInteger(maxPages) && maxPages > 0 ? maxPages : 1;
    let data: ScrapeResultGenParams<AmazonProductDTO>[] = await this.amazonScraperService.scrapeAggregateProductsBySearchKw(keyword, maxPages);

    const GOLANG_SERVER_URL = process.env.GOLANG_API_URL || 'http://localhost:4001/api/v1/projects/4b05d7ff-38b5-4a30-87b7-248149f34a5a/scraping/amazon/save-jobs';

    // try {
    //   // Golang Handler của bạn mong đợi một Mảng JSON (Array) -> `data` chính là Array đó.
    //   const goResponse = await axios.post(GOLANG_SERVER_URL, data, {
    //     headers: {
    //       'Content-Type': 'application/json',
    //       "Authorization": `Bearer ${token}`
    //     }
    //   });

    //   console.log('✅ Gửi sang Golang thành công:', goResponse.data);
    // } catch (goError) {
    //   console.error('❌ Lỗi khi gửi sang Golang:', goError);
    // }

      // 3. Trả về kết quả cho Client (Postman/Frontend)
      res.status(200).json({
        message: "Scraping completed",
        syncedToDb: true, // Flag báo hiệu đã sync
        count: data.length,
        data,
      });
  };
}

export interface ExcelTestBodyDto {
  data: AmazonScrapeResultParams[];
};

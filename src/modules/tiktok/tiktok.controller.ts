import BaseController from "#types/base/base.controller.js";
import { NextFunction, Request, Response, Router } from "express";
import { inject, injectable } from "tsyringe";
import TiktokScraperService from "./tiktok.service";
import { ScrapeResultParams } from "#types/index.js";
import { getTokenFromRequest } from "#share/auth.js";
import { ExcelLeadRow, FeCreditLeadResponse, TikTokCommentDTO } from "#types/tiktok/index.js";
import fs from 'fs/promises';
import path from "path";
import _ from "lodash";

@injectable()
export default class TiktokController implements BaseController {
  public readonly path: string = "/tiktok";
  public readonly router: Router = Router();

  constructor(@inject(TiktokScraperService) private readonly tiktokScraperService: TiktokScraperService) {
    this.initRoutes();
  }

  private initRoutes = (): void => {
    // this.router.route(`${this.path}/scrape/:projectId`).post(this.scrapeProfile);
    this.router.route(`${this.path}/scrape/comments`).post(this.scrapeCommentsByVideoId);
    this.router.route(`${this.path}/scrape/comments/all`).get(this.readCommentsAndFilterPhoneNumber);
  };

  private readCommentsAndFilterPhoneNumber = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const filePath = path.join(process.cwd(), "data.json");

      console.log(`📂 Đang đọc file từ: ${filePath}`);

      // 2. Kiểm tra file có tồn tại không
      try {
        await fs.access(filePath);
      } catch {
        console.error("❌ Không tìm thấy file data.json ở thư mục gốc!");
      }

      const fileContent = await fs.readFile(filePath, "utf-8");
      const jsonData = JSON.parse(fileContent) as FeCreditLeadResponse;

      if (jsonData.result && Array.isArray(jsonData.result)) {
        console.log(`✅ Đã đọc thành công ${jsonData.count} leads từ file JSON.`);
        let data = jsonData.result;
        data = data.map(item => {
            return {
                ...item,
                "TÊN KHÁCH HÀNG": _.startCase(_.toLower(item["TÊN KHÁCH HÀNG"])) 
            };
        });
        data = data.filter(data => data["ĐIỆN THOẠI"] === "")

        res.status(200).json({
          message: "✅ Đã đọc thành công ${jsonData.count} leads từ file JSON.",
          data
        })
      } else {
        console.warn("⚠️ File JSON không có trường 'result' hoặc rỗng.");
        res.status(500).json({
          message: "⚠️ File JSON không có trường 'result' hoặc rỗng.",
          data: jsonData
        })
      }
    } catch (error) {
      console.error("🔥 Lỗi khi đọc file JSON:", error);
    }

  };

  private scrapeCommentsByVideoId = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { profileID, videoID } = req.body;

      if (!profileID) {
        res.status(400).json({ message: "Vui lòng cung cấp profileID." });
        return;
      }

      if (!videoID) {
        res.status(400).json({ message: "Vui lòng cung cấp videoID." });
        return;
      }

      console.log(`Bắt đầu scrape cho profile: ${profileID}`);
      const data: ExcelLeadRow[] = await this.tiktokScraperService.scrapeCommentsByVideoId(profileID, videoID);

      // let inbox

      res.status(200).json({
        message: `Scrape thành công các leads tiềm năng.`,
        count: data.length,
        result: data,
      });
    } catch (error) {
      next(error);
    }
  };

  // private scrapeProfile = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  //   try {
  //     // 1. Lấy profileId từ request params
  //     const { projectId } = req.params;
  //     const { tiktokID } = req.body;

  //     console.log(`Project ID là ${projectId}, profileId là ${tiktokID}`);

  //     // 2. Kiểm tra xem profileId có tồn tại không
  //     if (!projectId) {
  //       res.status(400).json({ message: "Vui lòng cung cấp projectId." });
  //       return;
  //     }

  //     if (!tiktokID) {
  //       res.status(400).json({ message: "Vui lòng cung cấp profileId." });
  //       return;
  //     }

  //     const token: string = getTokenFromRequest(req);
  //     console.log(`Bắt đầu scrape cho profile: ${tiktokID}`);
  //     const scrapedData: ScrapeResultParams | null = await this.tiktokScraperService.scrapeProfile(tiktokID, [projectId], token);

  //     // 4. Trả về kết quả thành công cho client
  //     res.status(200).json({
  //       message: `Scrape thành công profile ${tiktokID}. Tìm thấy ${scrapedData?.scrapeData.length} video.`,
  //       result: scrapedData,
  //     });
  //   } catch (error) {
  //     // 5. Nếu có lỗi, chuyển cho middleware xử lý lỗi của Express
  //     next(error);
  //   }
  // };
}

import { NextFunction, Request, Response, Router } from "express";
import BaseController from "../../../../types/base/base.controller";
import { inject, injectable } from "tsyringe";
import ShopeeProductService from "../services/product.service";

@injectable()
export default class ShopeeProductController implements BaseController {
    public readonly path: string = "/shopee_products";
    public readonly router: Router = Router();

    constructor(
        @inject(ShopeeProductService)
        private readonly productService: ShopeeProductService
    ) {
        this.initRoutes();
    }

    private initRoutes = (): void => {
        this.router.route(`${this.path}/scrape`)
            .post(this.getRecommendedProducts)
    }

    private getRecommendedProducts = async (
        req: Request,
        res: Response,
        next: NextFunction,
    ): Promise<void> => { // Khai báo rõ ràng kiểu trả về là Promise<void>
        console.log("Hello")
        try {
            // Gọi phương thức service và đợi nó hoàn thành.
            // Phương thức service nên tự xử lý việc gửi phản hồi (res.json(), res.send())
            // hoặc gọi next() nếu có lỗi mà nó không tự xử lý.
            const url = req.body.url as string;
            const data = await this.productService.collectRecommendedProducts(url);
            
            res.json({ data });
        } catch (error) {
            // Nếu có lỗi xảy ra trong quá trình gọi service (và service không bắt),
            // chuyển lỗi đó cho middleware xử lý lỗi của Express.
            next(error);
        }
    };
}
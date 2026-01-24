import "reflect-metadata";

import "./modules/shopee/products/bot/register.bot"; // <--- THÊM DÒNG NÀY
import { container } from "tsyringe";
import App from "./app";
import ShopeeProductController from "./modules/shopee/products/controllers/product.controller";
import dotenv from 'dotenv';
import FbController from "#modules/facebook/fb.controller.js";
import TiktokController from "#modules/tiktok/tiktok.controller.js";
import AmazonController from "#modules/amazon/products/controllers/amazon.controller.js";
import KemonoController from "#modules/kemono/controllers/kemono.controller.js";
dotenv.config();

const app = new App([
  container.resolve(ShopeeProductController),
  container.resolve(FbController),
  container.resolve(TiktokController),
  container.resolve(AmazonController),
  container.resolve(KemonoController)
], Number(process.env.SERVER_PORT))

console.log(process.env.HOST, process.env.SERVER_PORT, process.env.API_VERSION_1)
app.listen();

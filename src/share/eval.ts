import { AmazonHtmlSelectorManager } from "#constants/class+id.constants.js";
import { Page } from "puppeteer";

export async function retrieveCamelSpecificationByKey(camelPage: Page, key: string): Promise<string | null> {
  return await camelPage.$$eval(
    AmazonHtmlSelectorManager.product.classSelectorsManager.camelSite.rawTableSpecificationSelector,
    (rows, searchKey) => {
      const targetRow = rows.find((row) => {
        const firstCell = row.querySelector("td strong");
        return firstCell && firstCell.textContent.trim() === searchKey;
      });

      if (targetRow) {
        const valueCell = targetRow.querySelectorAll("td")[1];
        return valueCell ? valueCell.textContent.trim() : null;
      }
      return null;
    },
    key
  );
}

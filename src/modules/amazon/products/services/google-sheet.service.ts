import { google } from 'googleapis';
import { injectable } from 'tsyringe';
import * as path from 'path';

const KEY_FILE_PATH = path.join(process.cwd(), 'google-credentials.json');
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

@injectable()
export class GoogleSheetService {
  private sheetsApi;

  constructor() {
    this.sheetsApi = this.getAuthenticatedClient();
  }

  /**
   * Tạo một client đã được xác thực
   */
  private getAuthenticatedClient() {
    const auth = new google.auth.GoogleAuth({
      keyFile: KEY_FILE_PATH,
      scopes: SCOPES,
    });
    return google.sheets({ version: 'v4', auth });
  }

  /**
   * Lấy API client đã xác thực để sử dụng
   */
  public getClient() {
    return this.sheetsApi;
  }
}

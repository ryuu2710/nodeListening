import * as XLSX from 'xlsx';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

export const exportFileExcelToDesktop = (data: object[], fileName: string): boolean => {
  if (fileName.length === 0) {
    return false 
  }
  const worksheet = XLSX.utils.json_to_sheet(data)
  const workbook = XLSX.utils.book_new()

  XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet 1")
  const desktopPath = path.join(os.homedir(), "Desktop") //  Get path to user desktop
  const filePath = path.join(desktopPath, fileName)
  
  XLSX.writeFile(workbook, filePath)

  console.log(`Data exported to ${filePath}`)

  return true 
}

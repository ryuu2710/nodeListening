export function FormatVnTimeMsg(timeAsNumeric: number) {
  return `${new Date(timeAsNumeric).toLocaleString("vi-VN")}`
}

import { Request } from "express";

export function getTokenFromRequest(req: Request): string {
  const authHeader: any = req.headers["authorization"];
  var token: string = "";
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    console.log("Token không hợp lệ", authHeader);
  }
  token = authHeader.split(" ")[1];
  return token;
}

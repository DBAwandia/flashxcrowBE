import { Response } from "express";

export const handleServerError = (res: Response, error: any, message: string = "Internal Server Error"): Response => {
  console.error(error);
  return res.status(500).json({ message });
};

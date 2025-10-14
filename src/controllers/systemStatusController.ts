// controllers/System.controller.ts
import { Request, Response } from "express";
import System from "../model/systemStatusModel";

export const getSystemStatus = async (req: Request, res: Response) => {
  const identifier = req.query.identifier;

  if (identifier !== "systemUpdate") {
    res.status(400).json({ mesdage: "Invalid identifier" });
    return;
  }

  try {
    const stats = await System.findOne({ identifier });
    res.json(stats);
  } catch (error) {
    res.status(500).json({ message: "Error fetching stats", error });
  }
};

export const createOrUpdateSystem = async (req: Request, res: Response) => {
  try {
    const { identifier, systemName, isDowntime, status } = req.body;
    if (identifier !== "systemUpdate") {
      res.status(400).json({ mesdage: "Invalid identifier" });
      return;
    }
    if (!systemName || typeof isDowntime !== "boolean" || !status) {
      res.status(400).json({ message: "Missing required fields" });
      return;
    }

    const stat = await System.findOneAndUpdate(
      { identifier: identifier },
      { systemName, isDowntime, status, checkedAt: new Date() },
      { upsert: true, new: true }
    );

    res.status(200).json(stat);
  } catch (error) {
    res.status(500).json({ message: "Error saving system stat", error });
  }
};

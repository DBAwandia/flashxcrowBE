import express from "express";
import {
  authenticate,
  adminAndUserOnly,
  adminOnly
} from "../authenticate-middleware/middleware";
import {
  createOrUpdateSystem,
  getSystemStatus,
} from "../controllers/systemStatusController";

const router = express.Router();

//SYSTEM STATUS CREATE
router.get("/status", authenticate, adminAndUserOnly, getSystemStatus);

//SYSTEM STATUS UPDATE
router.put("/status", authenticate, adminOnly, createOrUpdateSystem);

export default router;

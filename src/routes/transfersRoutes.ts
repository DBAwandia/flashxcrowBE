import express from "express";
import {
  authenticate,
  adminAndUserOnly,
  adminOnly,
} from "../authenticate-middleware/middleware";
import {
  deleteTransfer,
  getAllTransfers,
  reversalTransfer,
  transferTraffic,
} from "../controllers/transfersController";

const router = express.Router();

//get all transfers
router.get("/", authenticate, adminAndUserOnly, getAllTransfers);

//Transfer traffic
router.post(
  "/",
  authenticate,
  adminAndUserOnly,
  transferTraffic
);

//Reverse Transfer traffic
router.put(
  "/reverse/:transferId",
  authenticate,
  adminAndUserOnly,
  reversalTransfer
);
router.delete(
  "/delete/:transferId",
  authenticate,
  adminOnly,
  deleteTransfer
);

export default router;

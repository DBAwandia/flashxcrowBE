import express from "express";
import {
  getTransactions,
  getTransaction,
  createTransaction,
  updateTransactionStatus,
  deleteTransaction,
  getProfits,
  getLatestSubscription,
} from "../controllers/transactionController";
import {
  // adminAndUserOnly,
  adminOnly,
  authenticate,
} from "../authenticate-middleware/middleware";

const router = express.Router();
router.get("/subscription/:id", authenticate, getLatestSubscription);
router.get("/", authenticate, getTransactions); // Only admin can view all transactions
router.get("/profits", authenticate, adminOnly, getProfits); // Only admin can view weekly profits
router.get("/:id", authenticate, getTransaction); // Users & admins can view specific transaction
router.post("/", createTransaction); // Only users & admins can create a deposit
router.put("/:id", authenticate,adminOnly, updateTransactionStatus); // Only admin can update status
router.delete("/:id", authenticate, deleteTransaction); // Only admin can delete transactions

export default router;

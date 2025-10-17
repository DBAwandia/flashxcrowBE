// routes/walletRoutes.ts
import express from "express";
import {
  getWalletTransactions,
  createDeposit,
  handleNowPaymentsWebhook,
  createWithdrawal,
  // createWithdrawal,
  // handleDepositCallback,
  // getPaymentStatus,
  // getWithdrawalStatus,
  // createWalletTransaction,
  updateWalletTransaction,
  // deleteWalletTransaction,
} from "../../controllers/escrow/walletController";
import { authenticate } from "../../authenticate-middleware/middleware";

const router = express.Router();

// Public callback endpoint (no authentication)
router.post("/callback",authenticate, handleNowPaymentsWebhook);

// Authenticated routes
router.get("/transactions",authenticate, getWalletTransactions);
router.post("/deposit",authenticate, createDeposit);
router.post("/payout",authenticate, createWithdrawal);
// router.get("/payment-status/:uuid", getPaymentStatus);
// router.get("/withdrawal-status/:uuid", getWithdrawalStatus);

// // Admin routes
// router.post("/transactions", createWalletTransaction);
router.put("/transactions/:id", updateWalletTransaction);
// router.delete("/transactions/:id", deleteWalletTransaction);

export default router;

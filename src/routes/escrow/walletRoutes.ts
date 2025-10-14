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
  // updateWalletTransaction,
  // deleteWalletTransaction,
} from "../../controllers/escrow/walletController";

const router = express.Router();

// Public callback endpoint (no authentication)
router.post("/callback", handleNowPaymentsWebhook);

// Authenticated routes
router.get("/transactions", getWalletTransactions);
router.post("/deposit", createDeposit);
router.post("/payout", createWithdrawal);
// router.get("/payment-status/:uuid", getPaymentStatus);
// router.get("/withdrawal-status/:uuid", getWithdrawalStatus);

// // Admin routes
// router.post("/transactions", createWalletTransaction);
// router.put("/transactions/:id", updateWalletTransaction);
// router.delete("/transactions/:id", deleteWalletTransaction);

export default router;

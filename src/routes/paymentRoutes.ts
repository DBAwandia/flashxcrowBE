import express from "express";
import {
  createInvoice,
  createKopokopoCharge,
  createPaystackCharge,
  getTransactionStatus,
  paymentKopokopoTracking,
  paymentMobileTracking,
  paymentTracking,
} from "../controllers/paymentController";
import {
  authenticate,
  adminAndUserOnly,
  // adminOnly,
} from "../authenticate-middleware/middleware";

const router = express.Router();

// PAYSTACK MOBILE MPESA
router.post("/create-charge", createPaystackCharge);

// KOPO KOPO MOBILE MPESA
router.post("/createCharge", createKopokopoCharge);

//COINPAL invoice API
router.post("/create-invoice", authenticate, createInvoice);

//COINPAL PAYMENT STATUS
router.post(
  "/payment-status",
  authenticate,
  adminAndUserOnly,
  getTransactionStatus
);

// COINPAL WEBHOOK
router.post("/webhook", paymentTracking); // Webhook should remain open to receive external payment updates

// PAYSTACK WEBHOOK
router.post("/paystack/webhook", paymentMobileTracking); // Webhook should remain open to receive external payment updates
router.post("/kopokopo/webhook", paymentKopokopoTracking); // Webhook should remain open to receive external payment updates


export default router;

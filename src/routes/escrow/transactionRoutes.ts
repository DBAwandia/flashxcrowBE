import express from "express";
import {
  deleteEscrowTransaction,
  createEscrowTransaction,
  updateEscrowTransaction,
  getEscrowTransactions,
} from "../../controllers/escrow/transactionController";
import { authenticate } from "../../authenticate-middleware/middleware";

const router = express.Router();

// 🧾 Create a new escrow transaction
router.post("/",authenticate, createEscrowTransaction);

//get all transactions
router.get("/",authenticate, getEscrowTransactions);

// 🔄 Update escrow transaction (status, dispute, etc.)
router.put("/:id",authenticate, updateEscrowTransaction);

// ❌ Delete escrow transaction — admin only & no dispute
router.delete("/:id",authenticate, deleteEscrowTransaction);

export default router;

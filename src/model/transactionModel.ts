import mongoose, { Schema, Document, Types } from "mongoose";

export interface ITransaction extends Document {
  orderId: string;
  userId: Types.ObjectId;
  transactionAmount: number;
  paidAmount?: number; // Optional: Track paid amount
  method: "Cryptocurrency" | "Mpesa" | "Mobile Payment";
  currency?: string;
  payUrl: string;
  paymentCount?: number;
  product: string;
  reference?: string;
  transactionStatus: string;
  amountGB: number; // Amount of GB sold
  createdAt: Date;
  currentSubscription?: string;
  currentSubscriptionDate?: Date;
  amount?: number; // Add this temporarily for backward compatibility
}

const TransactionSchema: Schema = new Schema(
  {
    orderId: { type: String, required: true, unique: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    transactionAmount: { type: Number, required: true, min: 1 },
    amount: { type: Number, required: false, min: 1 },
    paidAmount: { type: Number, required: false, min: 1 },
    paymentCount: { type: Number, required: false },
    product: { type: String, required: true },
    currency: { type: String, required: false },
    payUrl: { type: String, required: false },
    reference: { type: String, required: false },
    method: {
      type: String,
      enum: ["Cryptocurrency", "Mpesa", "Mobile Payment"],
      required: true,
    },
    transactionStatus: {
      type: String,
      enum: ["pending", "paid", "failed", "partial_paid", "expired"],
    },
    amountGB: { type: Number, required: true, min: 1 }, // Ensure amountGB is at least 1
    currentSubscription: { type: String, required: false },
    currentSubscriptionDate: { type: Date, required: false },
  },
  { timestamps: true }
);

const Transaction = mongoose.model<ITransaction>(
  "Transaction",
  TransactionSchema
);

export default Transaction;

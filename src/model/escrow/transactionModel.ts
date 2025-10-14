import mongoose, { Schema, Document } from "mongoose";

export interface IClaimApplied {
  code: string;
  reward: number;
  percentage: number;
  claimedBy: string; // ✅ user email or ID who used it
  usageCount: number; // ✅ number of times used
}

export interface IJoinedBy {
  email: string;
  role: "buyer" | "seller" | "broker";
  joinedAt: Date;
}

export interface IEscrowTransaction extends Document {
  buyerEmail: string;
  sellerEmail: string;
  brokerEmail?: string;
  brokerAmount?: number;
  item: string;
  description?: string;
  amount: number;
  fee: number;
  currency: string;
  payerRole: string;
  couponCode?: string;
  discountPercent?: number;
  claimCode?: string;
  claimApplied?: IClaimApplied | null;
  isClaimed?: boolean;

  // 🧩 Track joined parties
  joinedBy?: IJoinedBy[];

  hasDispute: boolean;
  isPaid: boolean;
  disputeReason?: string;
  disputedBy?: "Admin" | "Broker" | "Buyer" | "Seller";
  status:
    | "resolved"
    | "new"
    | "started"
    | "approved"
    | "pending"
    | "completed"
    | "cancelled"
    | "disputed";
  createdAt: Date;
  updatedAt: Date;
}

const EscrowTransactionSchema = new Schema<IEscrowTransaction>(
  {
    buyerEmail: { type: String, required: true },
    sellerEmail: { type: String, required: true },
    brokerEmail: { type: String },
    brokerAmount: { type: Number, required: true },
    payerRole: { type: String, required: true },
    item: { type: String, required: true },
    description: { type: String },
    amount: { type: Number, required: true },
    fee: { type: Number, required: true },
    currency: { type: String, required: true },

    // 💸 Discounts & claims
    couponCode: { type: String },
    discountPercent: { type: Number, default: 0 },
    claimCode: { type: String },
    claimApplied: {
      code: { type: String },
      reward: { type: Number },
      percentage: { type: Number },
      claimedBy: { type: String }, // ✅ user email or ID
      usageCount: { type: Number, default: 1 }, // ✅ how many times used
    },
    isClaimed: { type: Boolean, default: false },

    // 🧩 Joining escrow
    joinedBy: [
      {
        email: { type: String, required: true },
        role: {
          type: String,
          enum: ["buyer", "seller", "broker"],
          required: true,
        },
        joinedAt: { type: Date, default: Date.now },
      },
    ],

    // 💬 Dispute
    hasDispute: { type: Boolean, default: false },
    isPaid: { type: Boolean, default: false },
    disputeReason: { type: String },
    disputedBy: {
      type: String,
      enum: ["Admin", "Broker", "Buyer", "Seller"],
    },

    status: {
      type: String,
      enum: [
        "resolved",
        "started",
        "new",
        "approved",
        "pending",
        "completed",
        "cancelled",
        "disputed",
      ],
      default: "new",
    },
  },
  { timestamps: true }
);

const EscrowTransaction = mongoose.model<IEscrowTransaction>(
  "EscrowTransaction",
  EscrowTransactionSchema
);

export default EscrowTransaction;

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

  // 🆕 Split Fee Fields
  amountInUSD: number;
  feeInUSD: number;
  buyerFeeInUSD: number;
  sellerFeeInUSD: number;
  exchangeRate?: number;

  // 🧩 Track joined parties
  joinedBy?: IJoinedBy[];

  // ⏰ Maximum check time duration (stores the selected duration string)
  maxCheckTime?: "1h" | "4h" | "8h" | "24h" | "3d" | "7d" | "30d" | "any";

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
    brokerAmount: { type: Number, default: 0 },
    payerRole: { type: String, required: true },
    item: { type: String, required: true },
    description: { type: String },
    amount: { type: Number, required: true },
    fee: { type: Number, required: true },
    currency: { type: String, required: true },

    // 🆕 Split Fee Fields
    amountInUSD: { type: Number, required: true }, // Converted amount for internal calculations
    feeInUSD: { type: Number, required: true }, // Converted and discounted fee
    buyerFeeInUSD: { type: Number, default: 0 }, // Buyer's portion in split fee
    sellerFeeInUSD: { type: Number, default: 0 }, // Seller's portion in split fee
    exchangeRate: { type: Number }, // Exchange rate used for conversion

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

    // ⏰ Maximum check time duration
    maxCheckTime: {
      type: String,
      enum: ["1h", "4h", "8h", "24h", "3d", "7d", "30d", "any"],
    },

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
  "escrowtransactions",
  EscrowTransactionSchema
);

export default EscrowTransaction;
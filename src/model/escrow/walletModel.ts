import mongoose, { Schema, Document } from "mongoose";

export interface IWalletTransaction extends Document {
  userEmail: string;
  type: "deposit" | "withdrawal" | "transfer";
  method: string;
  amount: number;
  currency: string;
  orderId: string;
  description?: string;
  counterparty?: string;
  fee?: number;
  status:
    | "pending"
    | "processing"
    | "completed"
    | "failed"
    | "cancelled"
    | "partial"
    | "expired"
    | "refunded";
  date: Date;
  walletCredited?: boolean;

  // Payment processor data
  nowPaymentsData?: {
    orderId?: string;
    paymentId?: string;
    invoiceUrl?: string;
    paymentStatus?: string;
    payAddress?: string;
    payAmount?: number;
    payCurrency?: string;
    priceAmount?: number;
    priceCurrency?: string;
    ipnType?: string;
    createdAt?: Date;
    lastIpnUpdate?: Date;
    actually_paid?: number;
    outcome_currency?: string;
    outcome_amount?: number;
    purchase_id?: string;
    payoutId?: string;
    payoutStatus?: string;
  };

  nowPaymentsWithdrawalData?: {
    payoutId?: string;
    withdrawalId?: string;
    payoutStatus?: string;
    address?: string;
    amount?: number;
    currency?: string;
    txId?: string;
    createdAt?: Date;
    updatedAt?: Date;
    error?: string;
    refunded?: boolean;
    refundedAt?: Date;
    extraId?: string;
    payoutDescription?: string;
    uniqueExternalId?: string;
    lastIpnUpdate?: Date;
  };

  // Transfer information for escrow transactions
  transferInfo?: {
    fromUser?: string;
    toUser?: string;
    escrowTransactionId?: string;
    transferType?:
      | "escrow_funding"
      | "escrow_release"
      | "escrow_refund"
      | "claim_reward"
      | "broker_commission";
    participants?: {
      buyer?: string;
      seller?: string;
      broker?: string;
      payer?: string;
    };
    claimCodeUsed?: string;
    claimReward?: number;
    originalAmount?: number;
    netAmountAfterFees?: number;
  };

  // M-Pesa transactions
  mpesaData?: {
    phoneNumber?: string;
    orderId?: string;
    processed?: boolean;
    transactionId?: string;
    senderPhoneNumber?: string;
    senderFirstName?: string;
    senderLastName?: string;
    paymentStatus?: string;
    originationTime?: Date;
    paidAmount?: number;
    paidCurrency?: string;
    lastWebhookUpdate?: Date;
  };

  // Withdrawal information
  withdrawalInfo?: {
    address?: string;
    network?: string;
    addressTag?: string;
    phoneNumber?: string;
  };
}

const WalletTransactionSchema = new Schema<IWalletTransaction>(
  {
    userEmail: {
      type: String,
      required: true,
      index: true,
    },
    type: {
      type: String,
      required: true,
      enum: ["deposit", "withdrawal", "transfer"],
    },
    method: {
      type: String,
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      required: true,
      uppercase: true,
    },
    orderId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    description: {
      type: String,
    },
    counterparty: {
      type: String,
    },
    fee: {
      type: Number,
      default: 0,
      min: 0,
    },
    status: {
      type: String,
      default: "pending",
      enum: [
        "pending",
        "processing",
        "completed",
        "failed",
        "cancelled",
        "partial",
        "expired",
        "refunded",
      ],
    },
    date: {
      type: Date,
      default: Date.now,
      index: true,
    },
    walletCredited: {
      type: Boolean,
      default: false,
    },

    // NOW Payments data
    nowPaymentsData: {
      type: {
        orderId: String,
        paymentId: String,
        invoiceUrl: String,
        paymentStatus: String,
        payAddress: String,
        payAmount: Number,
        payCurrency: String,
        priceAmount: Number,
        priceCurrency: String,
        ipnType: String,
        createdAt: Date,
        lastIpnUpdate: Date,
        actually_paid: Number,
        outcome_currency: String,
        outcome_amount: Number,
        purchase_id: String,
        payoutId: String,
        payoutStatus: String,
      },
      default: {},
    },

    // NOW Payments withdrawal data
    nowPaymentsWithdrawalData: {
      type: {
        payoutId: String,
        withdrawalId: String,
        payoutStatus: String,
        address: String,
        amount: Number,
        currency: String,
        txId: String,
        createdAt: Date,
        updatedAt: Date,
        error: String,
        refunded: { type: Boolean, default: false },
        refundedAt: Date,
        extraId: String,
        payoutDescription: String,
        uniqueExternalId: String,
        lastIpnUpdate: Date,
      },
      default: null,
    },

    // Transfer information
    transferInfo: {
      type: {
        fromUser: String,
        toUser: String,
        escrowTransactionId: String,
        transferType: {
          type: String,
          enum: [
            "escrow_funding",
            "escrow_release",
            "escrow_refund",
            "claim_reward",
            "broker_commission",
          ],
        },
        participants: {
          buyer: String,
          seller: String,
          broker: String,
          payer: String,
        },
        claimCodeUsed: String,
        claimReward: Number,
        originalAmount: Number,
        netAmountAfterFees: Number,
      },
      default: {},
    },

    // M-Pesa data
    mpesaData: {
      type: {
        phoneNumber: String,
        orderId: String,
        processed: { type: Boolean, default: false },
        transactionId: String,
        senderPhoneNumber: String,
        senderFirstName: String,
        senderLastName: String,
        paymentStatus: String,
        originationTime: Date,
        paidAmount: Number,
        paidCurrency: String,
        lastWebhookUpdate: Date,
      },
      default: null,
    },

    // Withdrawal information
    withdrawalInfo: {
      type: {
        address: String,
        network: String,
        addressTag: String,
        phoneNumber: String,
      },
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
WalletTransactionSchema.index({ userEmail: 1, type: 1, status: 1 });
WalletTransactionSchema.index({ userEmail: 1, date: -1 });
WalletTransactionSchema.index({ status: 1, date: 1 });
WalletTransactionSchema.index({ "nowPaymentsData.paymentId": 1 });
WalletTransactionSchema.index({ "nowPaymentsWithdrawalData.payoutId": 1 });
WalletTransactionSchema.index({ walletCredited: 1 });
WalletTransactionSchema.index({ "nowPaymentsWithdrawalData.refunded": 1 });
WalletTransactionSchema.index({ "mpesaData.transactionId": 1 });
WalletTransactionSchema.index({ "mpesaData.phoneNumber": 1 });
WalletTransactionSchema.index({ "mpesaData.paymentStatus": 1 });
WalletTransactionSchema.index({ "transferInfo.escrowTransactionId": 1 });

// Virtuals
WalletTransactionSchema.virtual("netAmount").get(function () {
  return this.amount - (this.fee || 0);
});

// Methods
WalletTransactionSchema.methods.isSuccessful = function (): boolean {
  return this.status === "completed";
};

WalletTransactionSchema.methods.isPending = function (): boolean {
  return this.status === "pending" || this.status === "processing";
};

WalletTransactionSchema.methods.isWalletCredited = function (): boolean {
  return this.walletCredited === true;
};

WalletTransactionSchema.methods.isPayoutRefunded = function (): boolean {
  return this.nowPaymentsWithdrawalData?.refunded === true;
};

WalletTransactionSchema.methods.isMpesaProcessed = function (): boolean {
  return this.mpesaData?.processed === true;
};

// Static methods
WalletTransactionSchema.statics.findByUserAndDateRange = function (
  userEmail: string,
  startDate: Date,
  endDate: Date
) {
  return this.find({
    userEmail,
    date: { $gte: startDate, $lte: endDate },
  }).sort({ date: -1 });
};

WalletTransactionSchema.statics.findPendingCredits = function () {
  return this.find({
    status: "completed",
    walletCredited: false,
    type: "deposit",
  });
};

WalletTransactionSchema.statics.findFailedPayoutsForRefund = function () {
  return this.find({
    type: "withdrawal",
    status: "failed",
    "nowPaymentsWithdrawalData.refunded": false,
  });
};

WalletTransactionSchema.statics.findPendingMpesaTransactions = function () {
  return this.find({
    method: "mpesa",
    status: { $in: ["pending", "processing"] },
    "mpesaData.processed": false,
  });
};

WalletTransactionSchema.statics.findByNowPaymentsPaymentId = function (
  paymentId: string
) {
  return this.findOne({
    $or: [
      { "nowPaymentsData.paymentId": paymentId },
      { "nowPaymentsWithdrawalData.payoutId": paymentId },
    ],
  });
};

WalletTransactionSchema.statics.findByMpesaTransactionId = function (
  transactionId: string
) {
  return this.findOne({ "mpesaData.transactionId": transactionId });
};

WalletTransactionSchema.statics.findByEscrowTransactionId = function (
  escrowTransactionId: string
) {
  return this.find({
    "transferInfo.escrowTransactionId": escrowTransactionId,
  }).sort({ date: -1 });
};

WalletTransactionSchema.statics.getUserTotalDeposits = function (
  userEmail: string
) {
  return this.aggregate([
    {
      $match: {
        userEmail,
        type: "deposit",
        status: "completed",
      },
    },
    {
      $group: {
        _id: "$userEmail",
        totalDeposits: { $sum: "$amount" },
        depositCount: { $sum: 1 },
      },
    },
  ]);
};

WalletTransactionSchema.statics.getUserMpesaSummary = function (
  userEmail: string
) {
  return this.aggregate([
    {
      $match: {
        userEmail,
        method: "mpesa",
      },
    },
    {
      $group: {
        _id: "$status",
        count: { $sum: 1 },
        totalAmount: { $sum: "$amount" },
      },
    },
  ]);
};

WalletTransactionSchema.statics.getUserTransferHistory = function (
  userEmail: string,
  limit = 50
) {
  return this.find({
    $or: [
      { userEmail },
      { "transferInfo.fromUser": userEmail },
      { "transferInfo.toUser": userEmail },
    ],
    type: "transfer",
  })
    .sort({ date: -1 })
    .limit(limit);
};

export const WalletTransaction = mongoose.model<IWalletTransaction>(
  "wallettransactions",
  WalletTransactionSchema
);

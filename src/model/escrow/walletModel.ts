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
    | "refunded"
    | "rejected"
    | "frozen"
    | "disputed"
    | "approved";
  date: Date;
  walletCredited?: boolean;

  // 🆕 Admin notes and audit trail
  adminNotes?: string;
  rejectionReason?: string;
  cancellationReason?: string;
  refundReason?: string;
  disputeDetails?: {
    caseId?: string;
    reason?: string;
    partiesInvolved?: string[];
    openedAt?: Date;
    resolvedAt?: Date;
  };
  refundInfo?: {
    originalTransactionId?: string;
    reason?: string;
    refundAmount?: number;
    refundedAt?: Date;
    adminNotes?: string;
  };
  frozenAt?: Date;
  rejectedAt?: Date;
  cancelledAt?: Date;
  refundedAt?: Date;
  disputedAt?: Date;
  completedAt?: Date;
  approvedAt?: Date;
  updatedBy?: string; // Admin email who last updated

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
    exchangeRate?: number; // For KES to USD conversion
    amountInKES?: number; // Original KES amount for M-Pesa
  };

  // Withdrawal information
  withdrawalInfo?: {
    address?: string;
    network?: string;
    addressTag?: string;
    phoneNumber?: string;
  };

  // 🆕 Original request details for tracking
  originalRequest?: {
    requestedAmount?: number;
    requestedCurrency?: string;
    requestedAmountKES?: number; // For M-Pesa withdrawals
    exchangeRate?: number;
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
        "rejected",
        "frozen",
        "disputed",
        "approved"
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

    // 🆕 ADMIN NOTES AND AUDIT TRAIL
    adminNotes: {
      type: String,
      default: ""
    },
    rejectionReason: {
      type: String,
      default: ""
    },
    cancellationReason: {
      type: String,
      default: ""
    },
    refundReason: {
      type: String,
      default: ""
    },
    disputeDetails: {
      type: {
        caseId: String,
        reason: String,
        partiesInvolved: [String],
        openedAt: Date,
        resolvedAt: Date
      },
      default: null
    },
    refundInfo: {
      type: {
        originalTransactionId: Schema.Types.ObjectId,
        reason: String,
        refundAmount: Number,
        refundedAt: Date,
        adminNotes: String
      },
      default: null
    },
    frozenAt: {
      type: Date,
      default: null
    },
    rejectedAt: {
      type: Date,
      default: null
    },
    cancelledAt: {
      type: Date,
      default: null
    },
    refundedAt: {
      type: Date,
      default: null
    },
    disputedAt: {
      type: Date,
      default: null
    },
    completedAt: {
      type: Date,
      default: null
    },
    approvedAt: {
      type: Date,
      default: null
    },
    updatedBy: {
      type: String,
      default: ""
    },

    // 🆕 ORIGINAL REQUEST TRACKING
    originalRequest: {
      type: {
        requestedAmount: Number,
        requestedCurrency: String,
        requestedAmountKES: Number,
        exchangeRate: Number
      },
      default: {}
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
        exchangeRate: Number,
        amountInKES: Number,
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

// 🆕 New indexes for admin features
WalletTransactionSchema.index({ status: 1, updatedAt: -1 });
WalletTransactionSchema.index({ "disputeDetails.caseId": 1 });
WalletTransactionSchema.index({ updatedBy: 1 });
WalletTransactionSchema.index({ refundedAt: 1 });
WalletTransactionSchema.index({ frozenAt: 1 });

// Virtuals
WalletTransactionSchema.virtual("netAmount").get(function () {
  return this.amount - (this.fee || 0);
});

// 🆕 Virtual for transaction age
WalletTransactionSchema.virtual("ageInDays").get(function () {
  return Math.floor((Date.now() - this.date.getTime()) / (1000 * 60 * 60 * 24));
});

// 🆕 Virtual for dispute status
WalletTransactionSchema.virtual("isUnderDispute").get(function () {
  return this.status === 'frozen' || this.status === 'disputed';
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

// 🆕 New methods for admin operations
WalletTransactionSchema.methods.canRefund = function (): boolean {
  return this.status === 'completed' && this.type === 'deposit' && !this.refundedAt;
};

WalletTransactionSchema.methods.canFreeze = function (): boolean {
  return ['pending', 'processing', 'completed'].includes(this.status) && !this.frozenAt;
};

WalletTransactionSchema.methods.canReject = function (): boolean {
  return this.status === 'pending' || this.status === 'processing';
};

WalletTransactionSchema.methods.addAdminNote = function (note: string, adminEmail: string) {
  const timestamp = new Date().toISOString();
  const newNote = `[${timestamp}] ${adminEmail}: ${note}\n`;
  this.adminNotes = (this.adminNotes || '') + newNote;
  this.updatedBy = adminEmail;
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

// 🆕 New static methods for admin features
WalletTransactionSchema.statics.findTransactionsWithDisputes = function () {
  return this.find({
    status: { $in: ['frozen', 'disputed'] }
  }).sort({ disputedAt: -1 });
};

WalletTransactionSchema.statics.findRefundedTransactions = function (
  startDate?: Date,
  endDate?: Date
) {
  const match: any = { status: 'refunded' };
  if (startDate && endDate) {
    match.refundedAt = { $gte: startDate, $lte: endDate };
  }
  return this.find(match).sort({ refundedAt: -1 });
};

WalletTransactionSchema.statics.findTransactionsByAdmin = function (
  adminEmail: string
) {
  return this.find({ updatedBy: adminEmail }).sort({ updatedAt: -1 });
};

export const WalletTransaction = mongoose.model<IWalletTransaction>(
  "wallettransactions",
  WalletTransactionSchema
);
// utils/updateWalletStatus.ts
import { Types } from "mongoose";
import { WalletTransaction } from "../../model/escrow/walletModel";

/**
 * Update or create WalletTransaction entry based on escrow event.
 */
export async function updateWalletStatus(
  userEmail: string,
  status: string,
  orderId: string,
  description: string,
  session: any,
  {
    amount = 0,
    currency = "USD",
    fee = 0,
    transferInfo = {},
    refundInfo = null,
    disputeDetails = null,
    claimInfo = null,
    updatedBy = "system",
  }: {
    amount?: number;
    currency?: string;
    fee?: number;
    transferInfo?: Record<string, any>;
    refundInfo?: Record<string, any> | null;
    disputeDetails?: Record<string, any> | null;
    claimInfo?: Record<string, any> | null;
    updatedBy?: string;
  } = {}
) {
  const now = new Date();

  const existingTx = await WalletTransaction.findOne({ orderId }).session(
    session
  );

  const updateFields: Record<string, any> = {
    status,
    amount,
    currency,
    description,
    fee,
    transferInfo,
    refundInfo,
    disputeDetails,
    updatedBy,
    date: now,
  };

  // handle timestamps dynamically
  const tsMap: Record<string, string> = {
    approved: "approvedAt",
    refunded: "refundedAt",
    cancelled: "cancelledAt",
    disputed: "disputedAt",
    completed: "completedAt",
    frozen: "frozenAt",
  };

  if (tsMap[status]) updateFields[tsMap[status]] = now;

  if (claimInfo)
    updateFields["transferInfo.claimReward"] = claimInfo.reward || 0;

  if (!existingTx) {
    await WalletTransaction.create(
      [
        {
          userEmail,
          type: "transfer",
          method: "escrow",
          amount,
          currency,
          fee,
          orderId,
          description,
          status,
          walletCredited: ["approved", "refunded", "completed"].includes(
            status
          ),
          transferInfo,
          refundInfo,
          disputeDetails,
          updatedBy,
          counterparty:
            transferInfo?.from && transferInfo?.to
              ? transferInfo.from === userEmail
                ? transferInfo.to
                : transferInfo.from
              : null,
          ...(tsMap[status] ? { [tsMap[status]]: now } : {}),
        },
      ],
      { session }
    );
  } else {
    await WalletTransaction.findOneAndUpdate(
      { orderId },
      { $set: updateFields },
      { session }
    );
  }

  return true;
}

interface Coupon {
  code: string;
  discountPercent: number;
  expiresAt?: Date;
  isActive?: boolean;
}

const HARDCODED_COUPONS: Coupon[] = [
  { code: "XWADDA", discountPercent: 50 },
  { code: "DISCUSSION", discountPercent: 50 },
  { code: "NEWUSER10", discountPercent: 10 },
];

/**
 * Applies a coupon discount to a given fee amount.
 *
 * @param feeInUSD - The fee amount before discount (in USD)
 * @param couponCode - The provided coupon code (optional)
 * @returns { discountedFeeInUSD, discountApplied }
 */
export const applyCouponDiscount = async (
  feeInUSD: number,
  couponCode?: string
): Promise<{ discountedFeeInUSD: number; discountApplied: number }> => {
  if (!couponCode) {
    return { discountedFeeInUSD: feeInUSD, discountApplied: 0 };
  }

  const coupon = HARDCODED_COUPONS.find(
    (c) => c.code.toUpperCase() === couponCode.toUpperCase()
  );

  if (!coupon) {
    // ❌ Invalid or expired coupon
    throw new Error("Invalid or expired coupon code.");
  }

  if (coupon.expiresAt && new Date(coupon.expiresAt) < new Date()) {
    throw new Error("Coupon has expired.");
  }

  if (coupon.isActive === false) {
    throw new Error("Coupon is inactive.");
  }

  const discountApplied = coupon.discountPercent;
  const discountedFeeInUSD = feeInUSD * ((100 - discountApplied) / 100);

  return { discountedFeeInUSD, discountApplied };
};

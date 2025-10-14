import { WalletTransaction } from "../../model/escrow/walletModel";

/**
 * @desc Log wallet transfer for escrow transactions
 */
export const logWalletTransfer = async (
  userEmail: string,
  type: "deposit" | "withdrawal" | "transfer",
  method: string,
  amount: number,
  currency: string,
  description: string,
  transferInfo: any,
  status: "completed" | "failed" | "processing" = "completed",
  session: any = null
) => {
  try {
    const transactionData = {
      userEmail,
      type,
      method,
      amount,
      currency,
      orderId: `transfer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      description,
      status,
      date: new Date(),
      walletCredited: true,
      transferInfo
    };

    const options = session ? { session } : {};
    const walletTransaction = new WalletTransaction(transactionData);
    await walletTransaction.save(options);
    
    return walletTransaction;
  } catch (error) {
    console.error("Error logging wallet transfer:", error);
    throw error;
  }
};

/**
 * @desc Log escrow funding transaction
 */
export const logEscrowFunding = async (
  payerEmail: string,
  amount: number,
  fee: number,
  escrowTransactionId: string,
  participants: any,
  session: any
) => {
  const totalAmount = amount + fee;
  
  return await logWalletTransfer(
    payerEmail,
    "withdrawal",
    "escrow",
    totalAmount,
    "USD",
    `Escrow funding for transaction ${escrowTransactionId}`,
    {
      fromUser: payerEmail,
      escrowTransactionId,
      transferType: "escrow_funding",
      participants,
      originalAmount: amount,
      netAmountAfterFees: amount,
    },
    "completed",
    session
  );
};

/**
 * @desc Log escrow release to seller
 */
export const logEscrowReleaseToSeller = async (
  sellerEmail: string,
  amount: number,
  escrowTransactionId: string,
  participants: any,
  session: any
) => {
  return await logWalletTransfer(
    sellerEmail,
    "deposit",
    "escrow",
    amount,
    "USD",
    `Escrow release for transaction ${escrowTransactionId}`,
    {
      toUser: sellerEmail,
      escrowTransactionId,
      transferType: "escrow_release",
      participants,
      originalAmount: amount,
      netAmountAfterFees: amount,
    },
    "completed",
    session
  );
};

/**
 * @desc Log broker commission payment
 */
export const logBrokerCommission = async (
  brokerEmail: string,
  amount: number,
  escrowTransactionId: string,
  participants: any,
  session: any
) => {
  return await logWalletTransfer(
    brokerEmail,
    "deposit",
    "escrow",
    amount,
    "USD",
    `Broker commission for transaction ${escrowTransactionId}`,
    {
      toUser: brokerEmail,
      escrowTransactionId,
      transferType: "broker_commission",
      participants,
      originalAmount: amount,
      netAmountAfterFees: amount,
    },
    "completed",
    session
  );
};

/**
 * @desc Log claim code reward
 */
export const logClaimReward = async (
  claimOwnerEmail: string,
  rewardAmount: number,
  claimCode: string,
  escrowTransactionId: string,
  session: any
) => {
  return await logWalletTransfer(
    claimOwnerEmail,
    "deposit",
    "claim_reward",
    rewardAmount,
    "USD",
    `Claim code reward for code ${claimCode}`,
    {
      toUser: claimOwnerEmail,
      escrowTransactionId,
      transferType: "claim_reward",
      claimCodeUsed: claimCode,
      claimReward: rewardAmount,
      originalAmount: rewardAmount,
      netAmountAfterFees: rewardAmount,
    },
    "completed",
    session
  );
};

/**
 * @desc Log escrow refund
 */
export const logEscrowRefund = async (
  recipientEmail: string,
  amount: number,
  escrowTransactionId: string,
  participants: any,
  session: any
) => {
  return await logWalletTransfer(
    recipientEmail,
    "deposit",
    "escrow_refund",
    amount,
    "USD",
    `Escrow refund for transaction ${escrowTransactionId}`,
    {
      toUser: recipientEmail,
      escrowTransactionId,
      transferType: "escrow_refund",
      participants,
      originalAmount: amount,
      netAmountAfterFees: amount,
    },
    "completed",
    session
  );
};
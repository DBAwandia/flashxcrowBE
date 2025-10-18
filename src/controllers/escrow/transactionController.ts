import { Request, Response } from "express";
import mongoose from "mongoose";
import User, { IClaimCode, IUser } from "../../model/userModel";
import EscrowTransaction from "../../model/escrow/transactionModel";
import { handleServerError } from "../../utils/handleServerError";
import { AuthenticatedRequest } from "../../authenticate-middleware/middleware";
import { convertToUSD, exchangeRate } from "../../utils/conversion";
import {
  applyCouponDiscount,
  updateWalletStatus,
} from "../../utils/escrow/utils";

/**
 * @desc Create a new escrow transaction using buyer/seller emails
 */

export const createEscrowTransaction = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      buyerEmail,
      sellerEmail,
      brokerEmail,
      brokerAmount,
      item,
      description,
      amount,
      fee,
      role,
      payerRole,
      currency,
      couponCode,
      maxCheckTime,
      claimCode,
    } = req.body;

    // --- 1️⃣ Validate Required Fields ---
    if (!buyerEmail || !sellerEmail || !amount || !currency) {
      res.status(400).json({ message: "Missing required fields." });
      return;
    }

    const buyer = await User.findOne({ email: buyerEmail }).session(session);
    const seller = await User.findOne({ email: sellerEmail }).session(session);

    if (!buyer || !seller) {
      res.status(404).json({ message: "Buyer or Seller not found." });
      return;
    }

    // --- 2️⃣ Handle Conversion & Discount (Store in USD) ---
    const amountInUSD = convertToUSD(amount, currency);
    const feeInUSD = convertToUSD(fee || 0, currency);

    const { discountedFeeInUSD, discountApplied } = await applyCouponDiscount(
      feeInUSD,
      couponCode
    );

    let buyerFeeInUSD = 0;
    let sellerFeeInUSD = 0;
    let isPaid = false;

    // --- 3️⃣ Payment Logic (runs for both buyer/seller roles) ---
    // --- 3️⃣ Payment Logic (buyer always pays principal) ---
    if (["buyer", "seller"].includes(role)) {
      const principalInUSD = amountInUSD;

      // Buyer must always have enough to cover principal (and maybe fee)
      const buyerMustPay =
        payerRole === "buyer"
          ? principalInUSD + discountedFeeInUSD
          : principalInUSD;

      if (buyer.walletBalance < buyerMustPay) {
        await session.abortTransaction();
        session.endSession();
        res.status(400).json({ message: "Insufficient buyer wallet balance." });
        return;
      }

      // --- Deduct principal from buyer (always) ---
      await User.findOneAndUpdate(
        { email: buyer.email, walletBalance: { $gte: buyerMustPay } },
        {
          $inc: {
            walletBalance: -buyerMustPay,
            walletFrozeBalance: buyerMustPay,
          },
        },
        { session }
      );

      await updateWalletStatus(
        buyer.email,
        "frozen",
        `${buyer.email}-${Date.now()}`,
        "Buyer funds (principal + optional fee) frozen for escrow",
        session,
        {
          amount: buyerMustPay,
          currency: "USD",
          fee: payerRole === "buyer" ? discountedFeeInUSD : 0,
          transferInfo: {
            type: "escrow_fund_freeze",
            from: buyer.email,
            to: sellerEmail,
            payerRole,
          },
          claimInfo: claimCode ? { code: claimCode } : null,
          updatedBy: req.user?.email,
        }
      );

      // --- Assign fee responsibility ---
      switch (payerRole) {
        case "buyer":
        default:
          buyerFeeInUSD = discountedFeeInUSD;
          sellerFeeInUSD = 0;
          isPaid = true; // buyer already paid fee
          break;

        case "seller":
          buyerFeeInUSD = 0;
          sellerFeeInUSD = discountedFeeInUSD;
          isPaid = false; // seller pays fee later
          break;

        case "split":
          buyerFeeInUSD = discountedFeeInUSD / 2;
          sellerFeeInUSD = discountedFeeInUSD / 2;
          isPaid = false; // split fees later
          break;
      }
    }

    // --- 4️⃣ Auto-Join Creator ---
    const joinedBy: any[] = [];
    const creatorEmail = req.user?.email;

    if (creatorEmail) {
      let creatorRole: "buyer" | "seller" | "broker" | undefined;

      if (creatorEmail === buyerEmail) creatorRole = "buyer";
      else if (creatorEmail === sellerEmail) creatorRole = "seller";
      else if (creatorEmail === brokerEmail) creatorRole = "broker";

      if (creatorRole) {
        joinedBy.push({
          email: creatorEmail,
          role: creatorRole,
          joinedAt: new Date(),
        });
      }
    }

    // --- 5️⃣ Create Escrow Transaction ---
    const escrowTx = await EscrowTransaction.create(
      [
        {
          buyerEmail,
          sellerEmail,
          brokerEmail,
          brokerAmount,
          item,
          description,
          amount,
          amountInUSD,
          fee,
          feeInUSD,
          buyerFeeInUSD,
          sellerFeeInUSD,
          role,
          payerRole,
          currency,
          couponCode,
          maxCheckTime,
          claimCode,
          isPaid,
          discountPercent: discountApplied ? discountApplied : 0,
          joinedBy,
          createdBy: creatorEmail,
          status: "new",
        },
      ],
      { session }
    );

    // --- 6️⃣ Commit ---
    await session.commitTransaction();
    session.endSession();

    // ✅ Return Response
    return res.status(201).json({
      success: true,
      message: "Escrow transaction created successfully.",
      transaction: escrowTx[0],
    });
  } catch (error: any) {
    await session.abortTransaction();
    session.endSession();
    console.error("❌ Error creating escrow transaction:", error);

    return res.status(500).json({
      message: "Failed to create escrow transaction.",
      error: error.message,
    });
  }
};

/**
 * @desc Get all escrow transactions (with filters and pagination)
 */

export const getEscrowTransactions = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const { page = 1, limit = 50, userEmail, status, search } = req.query;

    const pageNumber = Number(page);
    const limitNumber = Number(limit);
    const filter: any = {};

    const isAdmin = req?.user?.isAdmin;
    const authEmail = req?.user?.email;

    // 🚫 Prevent users from querying other people's data
    if (!isAdmin && userEmail && userEmail !== authEmail) {
      res.status(403).json({
        message: "Unauthorized: You can only access your own transactions.",
      });
      return;
    }

    // ✅ Restrict to own transactions if not admin
    if (!isAdmin) {
      filter.$or = [
        { buyerEmail: authEmail },
        { sellerEmail: authEmail },
        { brokerEmail: authEmail },
      ];
    } else if (userEmail) {
      // Allow admin to filter by specific user if needed
      filter.$or = [
        { buyerEmail: userEmail },
        { sellerEmail: userEmail },
        { brokerEmail: userEmail },
      ];
    }

    // 🧩 Filter by status
    if (status) filter.status = status;

    // 🔍 Search logic
    if (search) {
      const searchRegex = new RegExp(search as string, "i");
      const orConditions: any[] = [
        { item: searchRegex },
        { description: searchRegex },
        { buyerEmail: searchRegex },
        { sellerEmail: searchRegex },
        { brokerEmail: searchRegex },
      ];

      // ✅ Add ObjectId match safely if search is a valid ObjectId
      if (mongoose.Types.ObjectId.isValid(search as string)) {
        orConditions.push({
          _id: new mongoose.Types.ObjectId(search as string),
        });
      }

      filter.$or = orConditions;
    }

    // 📦 Fetch paginated transactions
    const transactions = await EscrowTransaction.find(filter)
      .skip((pageNumber - 1) * limitNumber)
      .limit(limitNumber)
      .sort({ updatedAt: -1, createdAt: -1 });

    const totalTransactions = await EscrowTransaction.countDocuments(filter);

    // 📊 Fetch status stats
    const [newCount, inProgressCount, completedCount] = await Promise.all([
      EscrowTransaction.countDocuments({ ...filter, status: "new" }),
      EscrowTransaction.countDocuments({
        ...filter,
        status: { $in: ["started", "pending", "disputed"] },
      }),
      EscrowTransaction.countDocuments({
        ...filter,
        status: { $in: ["completed", "resolved", "approved"] },
      }),
    ]);

    res.json({
      totalTransactions,
      page: pageNumber,
      totalPages: Math.ceil(totalTransactions / limitNumber),
      stats: {
        new: newCount,
        inProgress: inProgressCount,
        completed: completedCount,
      },
      transactions,
    });
  } catch (error) {
    handleServerError(res, error, "Error fetching escrow transactions");
  }
};

// Updated applyClaimCodeReward with proper TypeScript types
async function applyClaimCodeReward(
  user: mongoose.Document<unknown, {}, IUser> & IUser & { _id: unknown },
  claimCode: string,
  fee: number,
  session: any
): Promise<{
  code: string;
  reward: number;
  percentage: number;
  claimedBy: string;
  usageCount: number;
} | null> {
  if (!claimCode || !user?.claimCodes) return null;

  // Find the claim code with proper typing
  const claim = user.claimCodes.find(
    (c: IClaimCode) =>
      c.code === claimCode && c.isActive && new Date(c.expiresAt) > new Date()
  );

  if (!claim) return null; // invalid or expired

  if (fee < 0) {
    throw new Error("Fee must be positive");
  }
  console.log(claim);

  if (claim.percentage < 0 || claim.percentage > 100) {
    throw new Error("Claim percentage invalid");
  }

  // Calculate reward based on percentage
  const reward = (fee * claim.percentage) / 100;
  console.log(reward);

  // 💰 Add the user's reward to their wallet
  user.walletBalance += reward;

  // Increment usage count
  claim.usageCount = (claim.usageCount || 0) + 1;

  // Disable if max usage reached
  if (claim.maxUsage && claim.usageCount >= claim.maxUsage) {
    claim.isActive = false;
  }

  await user.save({ session });

  // ✅ Calculate remaining amount for counterparty
  const remaining = fee - reward;

  // Credit remaining to fluidbrakes@gmail.com
  const counterpartyUser = await User.findOne({
    email: "fluidbrakes@gmail.com",
  }).session(session);
  if (counterpartyUser) {
    counterpartyUser.walletBalance += remaining;

    await updateWalletStatus(
      counterpartyUser.email,
      "completed",
      `claim-${claimCode}-remaining`,
      `Remaining ${100 - claim.percentage}% from claim code '${claimCode}'`,
      session,
      {
        amount: remaining,
        currency: "USD", // adjust if dynamic
        fee: 0,
        transferInfo: {
          transferType: "claim_remaining",
          from: user.email,
          claimCode,
        },
        updatedBy: user.email,
      }
    );

    await counterpartyUser.save({ session });
  }

  // Return full claim info for transaction record
  return {
    code: claimCode,
    reward,
    percentage: claim.percentage,
    claimedBy: user.email,
    usageCount: claim.usageCount,
  };
}

/**
 * @desc Update escrow transaction (e.g., status changes, disputes)
 */

export const updateEscrowTransaction = async (req: Request, res: Response) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const { requestingEmail, status, disputeReason } = req.body;
    const isAdmin = req.user?.isAdmin;

    const transaction = await EscrowTransaction.findById(id).session(session);
    if (!transaction) {
      await session.abortTransaction();
      res.status(404).json({ message: "Transaction not found" });
      return;
    }

    const [seller, buyer, broker, requestingUser] = await Promise.all([
      User.findOne({ email: transaction.sellerEmail }).session(session),
      User.findOne({ email: transaction.buyerEmail }).session(session),
      transaction.brokerEmail
        ? User.findOne({ email: transaction.brokerEmail }).session(session)
        : Promise.resolve(null),
      User.findOne({ email: requestingEmail }).session(session),
    ]);

    if (!seller || !buyer || !requestingUser) {
      await session.abortTransaction();
      res.status(404).json({ message: "User not found" });
      return;
    }

    // Prevent changes when already approved
    if (["approved"].includes(transaction.status)) {
      await session.abortTransaction();
      res
        .status(400)
        .json({ message: `Transaction already ${transaction.status}` });
      return;
    }

    const participants = {
      buyer: transaction.buyerEmail,
      seller: transaction.sellerEmail,
      broker: transaction.brokerEmail,
      payer: transaction.payerRole || "buyer",
    };
    const escrowTransactionId = (
      transaction._id as mongoose.Types.ObjectId
    ).toString();

    // Calculate amounts with proper fee handling
    const getTransactionAmounts = () => {
      const amountInUSD = transaction.amountInUSD || transaction.amount;
      const totalFees = transaction.feeInUSD || transaction.fee || 0;
      const buyerFee = transaction.buyerFeeInUSD || 0;
      const sellerFee = transaction.sellerFeeInUSD || 0;

      // Principal amount is always frozen from buyer
      const buyerPrincipal = amountInUSD;

      // Fee amounts based on payer role
      let buyerFeeAmount = 0;
      let sellerFeeAmount = 0;

      switch (transaction.payerRole) {
        case "buyer":
          buyerFeeAmount = totalFees;
          break;
        case "seller":
          sellerFeeAmount = totalFees;
          break;
        case "split":
          buyerFeeAmount = buyerFee;
          sellerFeeAmount = sellerFee;
          break;
        default:
          buyerFeeAmount = totalFees;
      }

      const buyerTotal = buyerPrincipal + buyerFeeAmount;
      const sellerTotal = sellerFeeAmount;

      return {
        buyerPrincipal,
        buyerTotal,
        sellerTotal,
        buyerFee: buyerFeeAmount,
        sellerFee: sellerFeeAmount,
        totalFees,
      };
    };

    // Calculate cancellation refunds - deduct full fee from buyer
    const getCancellationRefunds = () => {
      const amountInUSD = transaction.amountInUSD || transaction.amount;
      const totalFees = transaction.feeInUSD || transaction.fee || 0;

      // For cancellation, buyer gets principal back but loses the fee
      const buyerRefund = amountInUSD; // Only principal, no fees
      const feeDeduction = totalFees; // Full fee is deducted

      return {
        buyerRefund,
        feeDeduction,
        totalRefund: buyerRefund,
      };
    };

    // Handle claim code application
    const applyClaimCode = async () => {
      console.log(
        "🔹 applyClaimCode started for transaction:",
        transaction._id
      );

      if (transaction.claimCode && !transaction.isClaimed) {
        console.log(
          "🔹 Claim code exists and not yet applied:",
          transaction.claimCode
        );

        const claimOwner = await User.findOne({
          "claimCodes.code": transaction.claimCode,
          "claimCodes.isActive": true,
          "claimCodes.expiresAt": { $gt: new Date() },
        }).session(session);

        if (!claimOwner) {
          console.log("⚠️ Claim code owner not found or inactive/expired");
          return null;
        }

        console.log("🔹 Claim code owner found:", claimOwner.email);

        const claimCodeData = claimOwner?.claimCodes?.find(
          (c: IClaimCode) => c.code === transaction.claimCode
        );

        if (!claimCodeData) {
          console.log("⚠️ Claim code not found in user's claimCodes array");
          throw new Error("Claim code not found in user's claim codes");
        }

        console.log("🔹 Claim code data:", claimCodeData);

        if (
          claimCodeData.maxUsage &&
          claimCodeData.usageCount >= claimCodeData.maxUsage
        ) {
          console.log(
            "⚠️ Claim code has reached max usage:",
            claimCodeData.usageCount
          );
          throw new Error("Claim code has reached maximum usage limit");
        }

        const claimResponse = await applyClaimCodeReward(
          claimOwner,
          transaction.claimCode,
          transaction.feeInUSD || transaction.fee,
          session
        );

        console.log("🔹 Claim response from reward function:", claimResponse);

        if (claimResponse) {
          console.log(
            "🔹 Updating claim code usage count and transaction flags"
          );

          await User.findOneAndUpdate(
            {
              email: claimOwner.email,
              "claimCodes.code": transaction.claimCode,
            },
            {
              $inc: { "claimCodes.$.usageCount": 1 },
              $set: {
                "claimCodes.$.lastUsedAt": new Date(),
                "claimCodes.$.lastUsedBy": requestingEmail,
                "claimCodes.$.lastTransactionId": transaction._id,
              },
            },
            { session }
          );

          // Apply reward to wallet using updateWalletStatus
          await updateWalletStatus(
            claimOwner.email,
            "completed",
            `${transaction._id}-claim-reward`,
            `Claim code '${transaction.claimCode}' reward applied`,
            session,
            {
              amount: claimResponse.reward,
              currency: transaction.currency,
              fee: 0,
              transferInfo: {
                transferType: "claim_reward",
                participants,
                claimedBy: claimOwner.email,
              },
              updatedBy: requestingEmail,
            }
          );

          transaction.claimApplied = {
            code: transaction.claimCode,
            reward: claimResponse.reward,
            percentage: claimResponse.percentage,
            claimedBy: claimOwner.email,
            usageCount: claimCodeData.usageCount + 1,
          };
          transaction.isClaimed = true;

          console.log(
            "✅ Claim code successfully applied:",
            transaction.claimApplied
          );

          return claimResponse;
        } else {
          console.log("⚠️ Claim response was null");
        }
      } else {
        console.log("⚠️ No claim code to apply or already applied");
      }

      return null;
    };

    switch (status) {
      case "reopen": {
        if (!isAdmin && requestingEmail !== buyer.email) {
          await session.abortTransaction();
          res.status(403).json({
            message:
              "Only admin or transaction participants can reopen this transaction",
          });
          return;
        }

        if (transaction.status !== "cancelled") {
          await session.abortTransaction();
          res.status(400).json({
            message: "Only cancelled transactions can be reopened",
          });
          return;
        }

        transaction.status = "new";
        transaction.isPaid = false;
        transaction.joinedBy = [];
        transaction.hasDispute = false;
        transaction.disputeReason = undefined;
        transaction.disputedBy = undefined;

        const updatedTransaction = await EscrowTransaction.findByIdAndUpdate(
          transaction._id,
          {
            $set: {
              status: "new",
              isPaid: false,
              joinedBy: [],
              hasDispute: false,
              disputeReason: undefined,
              disputedBy: undefined,
              updatedAt: new Date(),
            },
          },
          { new: true, session }
        );

        await updateWalletStatus(
          requestingEmail,
          "processing",
          escrowTransactionId,
          "Escrow reopened — no wallet movement, audit log only",
          session,
          {
            amount: 0,
            currency: transaction.currency,
            transferInfo: {
              transferType: "reopen",
              participants,
            },
            updatedBy: requestingEmail,
          }
        );

        await session.commitTransaction();
        res.status(200).json({
          success: true,
          message: "Cancelled transaction has been reopened and is now 'new'.",
          transaction: updatedTransaction,
        });
        return;
      }

      case "join": {
        let role: "buyer" | "seller" | "broker" | null = null;
        if (requestingEmail === transaction.buyerEmail) role = "buyer";
        else if (requestingEmail === transaction.sellerEmail) role = "seller";
        else if (requestingEmail === transaction.brokerEmail) role = "broker";

        if (!role) {
          await session.abortTransaction();
          res
            .status(400)
            .json({ message: "Requesting email not part of transaction" });
          return;
        }

        if (!Array.isArray(transaction.joinedBy)) transaction.joinedBy = [];
        const alreadyJoined = transaction.joinedBy.some(
          (p) => p.email === requestingEmail
        );
        if (alreadyJoined) {
          await session.abortTransaction();
          res
            .status(400)
            .json({ message: `${role} has already joined this transaction` });
          return;
        }

        const { buyerTotal } = getTransactionAmounts();

        if (!transaction.isPaid) {
          // Buyer always freezes principal amount + their fee portion
          if (buyer.walletBalance < buyerTotal) {
            await session.abortTransaction();
            res.status(400).json({
              message: "Insufficient buyer balance to fund escrow",
            });
            return;
          }

          // Freeze buyer's principal + their fee portion
          buyer.walletBalance -= buyerTotal;
          buyer.walletFrozeBalance += buyerTotal;

          await updateWalletStatus(
            buyer.email,
            "frozen",
            escrowTransactionId,
            "Escrow funded — buyer frozen funds (principal + buyer fee portion)",
            session,
            {
              amount: transaction.amountInUSD,
              fee: buyerTotal - transaction.amountInUSD,
              currency: transaction.currency,
              transferInfo: {
                transferType: "escrow_funding",
                participants,
                payerRole: transaction.payerRole,
                principalAmount: transaction.amountInUSD,
                feeAmount: buyerTotal - transaction.amountInUSD,
                totalFrozen: buyerTotal,
              },
              updatedBy: requestingEmail,
            }
          );

          await buyer.save({ session });
          transaction.isPaid = true;
        }

        // Add participant
        const newParticipant = {
          email: requestingEmail,
          role,
          joinedAt: new Date(),
        };
        transaction.joinedBy.push(newParticipant);

        const joinedRoles = transaction.joinedBy.map((p) => p.role);
        if (joinedRoles.includes("buyer") && joinedRoles.includes("seller")) {
          transaction.status = "started";
        }

        const updatedTransaction = await EscrowTransaction.findByIdAndUpdate(
          transaction._id,
          {
            $set: {
              joinedBy: transaction.joinedBy,
              status: transaction.status,
              isPaid: transaction.isPaid,
              updatedAt: new Date(),
            },
          },
          { new: true, session }
        );

        await session.commitTransaction();
        res.status(200).json({
          success: true,
          message: `Escrow ${
            transaction.isPaid ? "funded and" : ""
          } joined successfully by ${role}`,
          transaction: updatedTransaction,
        });
        return;
      }

      case "cancelled": {
        const { buyerRefund, feeDeduction } = getCancellationRefunds();

        const joinedRoles = transaction.joinedBy?.map((p) => p.role) || [];
        const allPartiesJoined =
          joinedRoles.includes("buyer") && joinedRoles.includes("seller");

        // Only authorized users can cancel
        if (
          !isAdmin &&
          requestingEmail !== seller.email &&
          !(requestingEmail === buyer.email && !allPartiesJoined)
        ) {
          await session.abortTransaction();
          res.status(403).json({
            message:
              "Only seller, admin, or buyer (before all parties join) can cancel transaction.",
          });
          return;
        }

        // Apply claim code safely
        try {
          await applyClaimCode();
        } catch (error: any) {
          await session.abortTransaction();
          res.status(400).json({ message: error.message });
          return;
        }

        // Refund buyer principal only (fees are deducted)
        buyer.walletBalance += buyerRefund;

        const totalFrozenToRelease =
          (transaction.amountInUSD || transaction.amount) +
          (transaction.buyerFeeInUSD || 0);

        // Ensure walletFrozeBalance cannot go negative
        buyer.walletFrozeBalance = Math.max(
          0,
          buyer.walletFrozeBalance - totalFrozenToRelease
        );

        // Log principal refund
        await updateWalletStatus(
          buyer.email,
          "refunded",
          `${escrowTransactionId}-refund`,
          `Escrow cancelled — principal refunded`,
          session,
          {
            amount: buyerRefund,
            currency: transaction.currency,
            transferInfo: {
              transferType: "escrow_refund",
              participants,
              payerRole: transaction.payerRole,
              refundType: "principal_only",
            },
            refundInfo: {
              originalTransactionId: transaction._id,
              reason: "Escrow cancelled",
              principalRefund: buyerRefund,
              feeDeducted: feeDeduction,
              refundedAt: new Date(),
            },
            updatedBy: requestingEmail,
          }
        );

        // Log fee deduction as separate transaction (always positive)
        if (feeDeduction > 0) {
          await updateWalletStatus(
            buyer.email,
            "completed",
            `${escrowTransactionId}-fee`,
            `Escrow cancellation fee deducted`,
            session,
            {
              amount: feeDeduction, // positive value
              currency: transaction.currency,
              fee: feeDeduction,
              transferInfo: {
                transferType: "cancellation_fee",
                participants,
                feeType: "cancellation",
                direction: "debit", // indicate deduction
              },
              updatedBy: requestingEmail,
            }
          );
        }

        transaction.status = "cancelled";

        // Save all changes in the same session
        await Promise.all([
          buyer.save({ session }),
          transaction.save({ session }),
        ]);

        await session.commitTransaction();

        res.status(200).json({
          success: true,
          message: `Transaction cancelled. Buyer refunded ${buyerRefund} principal, ${feeDeduction} fee deducted.`,
          refunded: buyerRefund,
          feeDeducted: feeDeduction,
          transaction,
        });
        return;
      }

      case "approved": {
        if (!isAdmin && requestingEmail !== buyer.email) {
          await session.abortTransaction();
          res.status(403).json({ message: "Only buyer can approve" });
          return;
        }

        const { buyerTotal, sellerFee } = getTransactionAmounts();

        // Apply claim code for approval (if applicable)
        try {
          await applyClaimCode();
        } catch (error: any) {
          await session.abortTransaction();
          res.status(400).json({ message: error.message });
          return;
        }

        // 💵 Calculate seller payout (full amount)
        let sellerPayout = transaction.amountInUSD;

        // 💰 If seller is payer, they pay fee upon success
        if (transaction.payerRole === "seller" && sellerFee > 0) {
          if (seller.walletBalance >= sellerFee) {
            seller.walletBalance -= sellerFee;

            await updateWalletStatus(
              seller.email,
              "completed",
              `${escrowTransactionId}-seller-fee`,
              "Seller fee paid on approval",
              session,
              {
                amount: sellerFee, // ✅ always positive
                currency: transaction.currency,
                fee: sellerFee,
                transferInfo: {
                  transferType: "seller_fee_payment",
                  participants,
                  feeType: "service_fee",
                  direction: "debit", // mark as debit instead of negative
                },
                updatedBy: requestingEmail,
              }
            );
          } else {
            await session.abortTransaction();
            res
              .status(400)
              .json({ message: "Seller has insufficient balance for fee." });
            return;
          }
        }

        // ✅ Release funds to seller
        seller.walletBalance += sellerPayout;
        await updateWalletStatus(
          seller.email,
          "completed",
          `${escrowTransactionId}-payout`,
          "Escrow approved — funds released to seller",
          session,
          {
            amount: sellerPayout,
            currency: transaction.currency,
            transferInfo: {
              transferType: "escrow_release",
              participants,
              originalAmount: transaction.amount,
              netAmount: sellerPayout,
              feesPaid: transaction.payerRole === "seller" ? sellerFee : 0,
              direction: "credit",
            },
            updatedBy: requestingEmail,
          }
        );

        // ✅ Unfreeze buyer’s balance — no negative amounts!
        buyer.walletFrozeBalance -= buyerTotal;
        await updateWalletStatus(
          buyer.email,
          "completed",
          `${escrowTransactionId}-unfreeze`,
          "Buyer frozen funds released after approval",
          session,
          {
            amount: buyerTotal, // ✅ positive value
            currency: transaction.currency,
            transferInfo: {
              transferType: "escrow_release",
              participants,
              frozenAmount: buyerTotal,
              releaseType: "approval",
              direction: "debit",
            },
            updatedBy: requestingEmail,
          }
        );

        transaction.status = "approved";
        break;
      }

      // ... (dispute and resolved cases remain the same)
      case "disputed": {
        const isBuyer = requestingEmail === buyer.email;
        const isSeller = requestingEmail === seller.email;
        const isBroker =
          transaction.brokerEmail &&
          requestingEmail === transaction.brokerEmail;

        if (!isAdmin && !isBuyer && !isSeller && !isBroker) {
          await session.abortTransaction();
          res.status(403).json({
            message: "Only buyer, seller, broker, or admin can dispute",
          });
          return;
        }

        transaction.status = "disputed";
        transaction.hasDispute = true;
        transaction.disputeReason = disputeReason || "No reason provided";
        transaction.disputedBy = isAdmin
          ? "Admin"
          : isBuyer
          ? "Buyer"
          : isSeller
          ? "Seller"
          : "Broker";

        // Log dispute
        await updateWalletStatus(
          requestingEmail,
          "disputed",
          `${escrowTransactionId}-dispute`,
          `Dispute opened by ${requestingEmail}`,
          session,
          {
            amount: 0,
            currency: transaction.currency,
            transferInfo: {
              transferType: "escrow_dispute",
              participants,
              disputedBy: requestingEmail,
            },
            disputeDetails: {
              caseId: escrowTransactionId,
              reason: transaction.disputeReason,
              openedAt: new Date(),
            },
            updatedBy: requestingEmail,
          }
        );
        break;
      }

      case "resolved": {
        if (!isAdmin && requestingEmail !== transaction.brokerEmail) {
          await session.abortTransaction();
          res
            .status(403)
            .json({ message: "Only admin or broker can resolve disputes" });
          return;
        }

        transaction.hasDispute = false;
        transaction.status = "resolved";
        transaction.disputeReason = undefined;
        transaction.disputedBy = undefined;

        await updateWalletStatus(
          requestingEmail,
          "completed",
          `${escrowTransactionId}-resolve`,
          "Dispute resolved and audit cleared",
          session,
          {
            amount: 0,
            currency: transaction.currency,
            transferInfo: {
              transferType: "escrow_resolution",
              participants,
            },
            updatedBy: requestingEmail,
          }
        );
        break;
      }

      default:
        await session.abortTransaction();
        res.status(400).json({ message: "Invalid status update" });
        return;
    }

    // Save all changes
    await Promise.all([
      broker?.save({ session }),
      seller.save({ session }),
      buyer.save({ session }),
      transaction.save({ session }),
    ]);

    await session.commitTransaction();
    res.status(200).json({
      success: true,
      message: `Transaction ${status} successfully`,
      transaction,
    });
    return;
  } catch (error) {
    await session.abortTransaction();
    console.error("Error updating escrow transaction:", error);
    res.status(500).json({ message: "Internal server error" });
    return;
  } finally {
    session.endSession();
  }
};

export const editEscrowTransaction = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { transactionId } = req.params;
    const {
      buyerEmail,
      sellerEmail,
      brokerEmail,
      brokerAmount,
      item,
      description,
      amount,
      fee,
      payerRole,
      currency,
      couponCode,
      claimCode,
      status,
      isPaid,
    } = req.body;

    // ✅ Find existing transaction
    const existingTransaction = await EscrowTransaction.findById(transactionId);
    if (!existingTransaction) {
      await session.abortTransaction();
      res.status(404).json({ message: "Transaction not found." });
      return;
    }

    if (
      ["completed", "cancelled", "disputed"].includes(
        existingTransaction.status
      )
    ) {
      await session.abortTransaction();
      res.status(400).json({
        message: `Cannot edit transaction with status: ${existingTransaction.status}`,
      });
      return;
    }

    // 🔹 Fetch buyer and seller
    const [buyer, seller] = await Promise.all([
      User.findOne({
        email: buyerEmail || existingTransaction.buyerEmail,
      }).session(session),
      User.findOne({
        email: sellerEmail || existingTransaction.sellerEmail,
      }).session(session),
    ]);

    if (!buyer || !seller) {
      await session.abortTransaction();
      res.status(404).json({ message: "Buyer or Seller not found." });
      return;
    }

    // --- 1️⃣ Refund previously frozen funds ---
    const prevTotalFrozen =
      (existingTransaction.amountInUSD || existingTransaction.amount) +
      (existingTransaction.feeInUSD || 0);

    buyer.walletBalance += prevTotalFrozen;
    buyer.walletFrozeBalance = Math.max(
      0,
      buyer.walletFrozeBalance - prevTotalFrozen
    );

    await updateWalletStatus(
      buyer.email,
      "refunded",
      `${transactionId}-prev-refund`,
      "Refund previous escrow amount & fee due to edit",
      session,
      {
        amount: prevTotalFrozen,
        currency: existingTransaction.currency,
        transferInfo: { type: "escrow_refund_on_edit" },
        updatedBy: req.user?.email,
      }
    );

    // --- 2️⃣ Recalculate amounts for updated transaction ---
    const newAmount =
      amount !== undefined ? Number(amount) : existingTransaction.amount;
    const newFee = fee !== undefined ? Number(fee) : existingTransaction.fee;
    const newCurrency = currency || existingTransaction.currency;

    const amountInUSD = convertToUSD(newAmount, newCurrency);
    const feeInUSD = convertToUSD(newFee || 0, newCurrency);

    let discountedFeeInUSD = feeInUSD;
    let discountPercent = existingTransaction.discountPercent;

    if (couponCode) {
      const { discountedFeeInUSD: discounted, discountApplied } =
        await applyCouponDiscount(feeInUSD, couponCode);
      discountedFeeInUSD = discounted;
      discountPercent = discountApplied || 0;
    }

    // --- 3️⃣ Deduct and freeze funds afresh ---
    const totalToFreeze = amountInUSD + discountedFeeInUSD;

    if (buyer.walletBalance < totalToFreeze) {
      await session.abortTransaction();
      res.status(400).json({ message: "Insufficient wallet balance." });
      return;
    }

    buyer.walletBalance -= totalToFreeze;
    buyer.walletFrozeBalance += totalToFreeze;

    await updateWalletStatus(
      buyer.email,
      "frozen",
      `${transactionId}-updated-freeze`,
      "Freeze updated escrow amount & fee after edit",
      session,
      {
        amount: totalToFreeze,
        currency: newCurrency,
        fee: discountedFeeInUSD,
        transferInfo: { type: "escrow_freeze_on_edit" },
        claimInfo: claimCode ? { code: claimCode } : null,
        updatedBy: req.user?.email,
      }
    );

    // --- 4️⃣ Update transaction ---
    const updatedData: any = {
      buyerEmail: buyerEmail || existingTransaction.buyerEmail,
      sellerEmail: sellerEmail || existingTransaction.sellerEmail,
      brokerEmail: brokerEmail || existingTransaction.brokerEmail,
      brokerAmount:
        brokerAmount !== undefined
          ? Number(brokerAmount)
          : existingTransaction.brokerAmount,
      item: item ?? existingTransaction.item,
      description: description ?? existingTransaction.description,
      amount: newAmount,
      fee: newFee !== undefined ? newFee : existingTransaction.fee,
      amountInUSD,
      feeInUSD,
      buyerFeeInUSD: discountedFeeInUSD,
      payerRole: payerRole || existingTransaction.payerRole,
      currency: newCurrency,
      couponCode: couponCode ?? existingTransaction.couponCode,
      claimCode: claimCode ?? existingTransaction.claimCode,
      discountPercent,
      status: status ?? existingTransaction.status,
      isPaid: isPaid ?? existingTransaction.isPaid,
      updatedAt: new Date(),
    };

    const updatedTransaction = await EscrowTransaction.findByIdAndUpdate(
      transactionId,
      updatedData,
      { new: true, session, runValidators: true }
    );

    await buyer.save({ session });
    await session.commitTransaction();
    session.endSession();

    res.status(200).json({
      success: true,
      message:
        "Escrow transaction updated successfully with refreshed wallet balances.",
      transaction: updatedTransaction,
    });
    return;
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("❌ Error editing escrow transaction:", error);
    res.status(500).json({
      message: "Failed to edit escrow transaction",
      error: error,
    });
    return;
  }
};

// Refund frozen amounts to original participants
const refundFrozenAmounts = async (
  transaction: any,
  session: mongoose.ClientSession
) => {
  const totalFrozen = transaction.amountInUSD + transaction.feeInUSD;

  if (transaction.payerRole === "buyer") {
    // Refund to buyer
    await User.findOneAndUpdate(
      { email: transaction.buyerEmail },
      {
        $inc: {
          walletBalance: totalFrozen,
          walletFrozeBalance: -totalFrozen,
        },
      },
      { session }
    );
  } else if (transaction.payerRole === "seller") {
    // Refund to seller
    await User.findOneAndUpdate(
      { email: transaction.sellerEmail },
      {
        $inc: {
          walletBalance: totalFrozen,
          walletFrozeBalance: -totalFrozen,
        },
      },
      { session }
    );
  } else if (transaction.payerRole === "split") {
    // Refund split amounts
    const buyerTotal =
      transaction.amountInUSD + (transaction.buyerFeeInUSD || 0);
    const sellerTotal = transaction.sellerFeeInUSD || 0;

    await Promise.all([
      User.findOneAndUpdate(
        { email: transaction.buyerEmail },
        {
          $inc: {
            walletBalance: buyerTotal,
            walletFrozeBalance: -buyerTotal,
          },
        },
        { session }
      ),
      User.findOneAndUpdate(
        { email: transaction.sellerEmail },
        {
          $inc: {
            walletBalance: sellerTotal,
            walletFrozeBalance: -sellerTotal,
          },
        },
        { session }
      ),
    ]);
  }
};

// Deduct new amounts for updated transaction
const deductNewAmounts = async (
  existingTransaction: any,
  newData: any,
  session: mongoose.ClientSession
) => {
  const { buyerEmail, sellerEmail, amountInUSD, feeInUSD, payerRole } = newData;

  let buyerFeeInUSD = 0;
  let sellerFeeInUSD = 0;

  // Calculate fee allocation based on payer role
  if (payerRole === "buyer") {
    buyerFeeInUSD = feeInUSD;
  } else if (payerRole === "seller") {
    sellerFeeInUSD = feeInUSD;
  } else if (payerRole === "split") {
    buyerFeeInUSD = feeInUSD / 2;
    sellerFeeInUSD = feeInUSD / 2;
  }

  // Deduct amounts based on payer role
  if (payerRole === "buyer") {
    const totalAmountInUSD = amountInUSD + feeInUSD;
    await User.findOneAndUpdate(
      { email: buyerEmail },
      {
        $inc: {
          walletBalance: -totalAmountInUSD,
          walletFrozeBalance: totalAmountInUSD,
        },
      },
      { session }
    );
  } else if (payerRole === "seller") {
    const totalAmountInUSD = amountInUSD + feeInUSD;
    await User.findOneAndUpdate(
      { email: sellerEmail },
      {
        $inc: {
          walletBalance: -totalAmountInUSD,
          walletFrozeBalance: totalAmountInUSD,
        },
      },
      { session }
    );
  } else if (payerRole === "split") {
    const buyerTotal = amountInUSD + buyerFeeInUSD;
    const sellerTotal = sellerFeeInUSD;

    await Promise.all([
      User.findOneAndUpdate(
        { email: buyerEmail },
        {
          $inc: {
            walletBalance: -buyerTotal,
            walletFrozeBalance: buyerTotal,
          },
        },
        { session }
      ),
      User.findOneAndUpdate(
        { email: sellerEmail },
        {
          $inc: {
            walletBalance: -sellerTotal,
            walletFrozeBalance: sellerTotal,
          },
        },
        { session }
      ),
    ]);
  }

  // Update the fee allocation fields
  await EscrowTransaction.findByIdAndUpdate(
    existingTransaction._id,
    {
      buyerFeeInUSD,
      sellerFeeInUSD,
    },
    { session }
  );
};

/**
 * @desc Delete escrow transaction
 */
export const deleteEscrowTransaction = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // 🔍 Find the transaction first
    const transaction = await EscrowTransaction.findById(id);
    if (!transaction) {
      res.status(404).json({ message: "Transaction not found." });
      return;
    }

    // 🚫 Prevent deletion if it has an active dispute
    if (transaction.hasDispute || transaction.status === "disputed") {
      res.status(400).json({
        message: "Cannot delete a transaction that has an active dispute.",
      });
      return;
    }

    // 🚫 Prevent deletion if the transaction is already paid/completed
    const paidStatuses = ["completed", "approved", "cancelled", "disputed"];
    if (paidStatuses.includes(transaction.status)) {
      res.status(400).json({
        message: `Cannot delete a ${transaction.status} transaction — it has already been paid or finalized.`,
      });
      return;
    }

    if (transaction.isPaid) {
      res.status(403).json({
        message: " Transaction is already paid",
      });
      return;
    }

    // 🗑️ Proceed to delete
    await EscrowTransaction.findByIdAndDelete(id);

    res.json({
      success: true,
      message: "Escrow transaction deleted successfully.",
    });
  } catch (error) {
    handleServerError(res, error, "Error deleting escrow transaction");
  }
};

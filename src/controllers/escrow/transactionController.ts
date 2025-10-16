import { Request, Response } from "express";
import mongoose from "mongoose";
import User from "../../model/userModel";
import EscrowTransaction from "../../model/escrow/transactionModel";
import { handleServerError } from "../../utils/handleServerError";
import { AuthenticatedRequest } from "../../authenticate-middleware/middleware";
import {
  logBrokerCommission,
  logClaimReward,
  logEscrowFunding,
  logEscrowRefund,
  logEscrowReleaseToSeller,
  logSellerFeeDeduction,
} from "../../utils/escrow-transfers/escrowTansfers";
import { convertToUSD, exchangeRate } from "../../utils/conversion";

// helper to ensure numeric fields exist on a user doc (run inside the session)
async function ensureFields(user: any, session: any) {
  const setObj: any = {};
  if (user.walletBalance === undefined) setObj.walletBalance = 0;
  if (user.walletFrozeBalance === undefined) setObj.walletFrozeBalance = 0;
  if (user.hasDispute === undefined) setObj.hasDispute = false;

  if (Object.keys(setObj).length > 0) {
    await User.updateOne({ _id: user._id }, { $set: setObj }, { session });
    // return refreshed user
    await User.findById(user._id).session(session);
    return;
  }

  return user;
}

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
      brokerEmail, // optional
      brokerAmount, // optional
      item,
      description,
      amount,
      fee,
      role, // "buyer" | "seller" | "broker"
      payerRole, // "buyer" | "seller" | "split" (50/50)
      currency,
      couponCode,
      maxCheckTime,
      claimCode,
    } = req.body;

    // ✅ Basic validation
    if (!buyerEmail || !sellerEmail) {
      res.status(400).json({
        message: "Buyer and seller emails are required.",
      });
      return;
    }

    // ✅ Validate currency
    if (!currency || !["USD", "KES"].includes(currency.toUpperCase())) {
      res.status(400).json({
        message: "Currency must be either USD or KES",
      });
      return;
    }

    // ✅ Validate payerRole for seller/broker creators
    if (role === "seller" || role === "broker") {
      if (!payerRole || !["buyer", "seller", "split"].includes(payerRole)) {
        res.status(400).json({
          message:
            "payerRole is required when creator is seller or broker (must be 'buyer', 'seller', or 'split').",
        });
        return;
      }
    }

    // ✅ Validate payerRole for buyer creator
    if (
      role === "buyer" &&
      payerRole &&
      !["buyer", "seller", "split"].includes(payerRole)
    ) {
      res.status(400).json({
        message:
          "payerRole must be 'buyer', 'seller', or 'split' when creator is buyer.",
      });
      return;
    }

    // ✅ Validate claim code if provided
    if (claimCode) {
      const existingClaimCode = await User.findOne({
        "claimCodes.code": claimCode,
      });

      if (!existingClaimCode) {
        res.status(404).json({ message: "Invalid or non-existent claim code" });
        return;
      }

      const claim = existingClaimCode.claimCodes?.find(
        (c: any) => c.code === claimCode
      );

      if (!claim) {
        res.status(404).json({ message: "Invalid claim code configuration" });
        return;
      }

      if (new Date(claim.expiresAt) < new Date()) {
        res.status(400).json({ message: "Claim code has expired" });
        return;
      }

      if (!claim.isActive) {
        res.status(400).json({ message: "Claim code is inactive" });
        return;
      }

      if (claim.usageCount >= (claim.maxUsage || 1)) {
        res.status(400).json({ message: "Claim code usage limit reached" });
        return;
      }
    }

    // 🔍 Fetch users
    const [buyerRaw, sellerRaw, brokerRaw] = await Promise.all([
      User.findOne({ email: buyerEmail }),
      User.findOne({ email: sellerEmail }),
      brokerEmail ? User.findOne({ email: brokerEmail }) : null,
    ]);

    if (!buyerRaw || !sellerRaw) {
      res.status(404).json({
        message: `User not found: ${!buyerRaw ? "buyer" : "seller"}`,
      });
      return;
    }

    // ✅ Ensure wallet fields exist for all participants
    const buyer = await ensureFields(buyerRaw, session);
    const seller = await ensureFields(sellerRaw, session);
    const broker = brokerRaw ? await ensureFields(brokerRaw, session) : null;

    // 🧠 Dispute checks
    if (
      buyer.hasDispute ||
      seller.hasDispute ||
      (broker && broker.hasDispute)
    ) {
      res.status(403).json({
        message:
          "Transaction denied. One or more participants have an active dispute.",
      });
      return;
    }

    let isPaid = false;
    let buyerFeeInUSD = 0;
    let sellerFeeInUSD = 0;

    // 🔹 Hardcoded coupons array
    const HARDCODED_COUPONS = [
      { code: "XWADDA", discountPercent: 50 },
      { code: "DISCUSSION", discountPercent: 50 },
    ];

    // 🔹 Determine discount based on incoming couponCode
    let appliedCoupon: { code: string; discountPercent: number } | null = null;

    if (couponCode) {
      const found = HARDCODED_COUPONS.find(
        (c) => c.code.toUpperCase() === couponCode.toUpperCase()
      );

      if (!found) {
        await session.abortTransaction();
        res.status(400).json({ message: "Invalid or expired coupon code" });
        return;
      }

      appliedCoupon = found;
    }

    const numericAmount = Number(amount) || 0;
    const numericFee = Number(fee) || 0;

    // Convert amounts to USD for wallet operations
    const amountInUSD = convertToUSD(numericAmount, currency);
    const feeInUSD = convertToUSD(numericFee, currency);

    // ✅ Apply discount to fee
    const discountPercentToApply =
      (appliedCoupon && appliedCoupon?.discountPercent) || 0;

    const discountedFeeInUSD =
      discountPercentToApply > 0
        ? feeInUSD * ((100 - discountPercentToApply) / 100)
        : feeInUSD;

    // 💰 Handle payment logic based on role and payerRole
    if (role === "buyer") {
      // Buyer is creating the escrow
      if (payerRole === "buyer" || !payerRole) {
        // Default: buyer pays everything
        const totalAmountInUSD = amountInUSD + discountedFeeInUSD;
        buyerFeeInUSD = discountedFeeInUSD;
        sellerFeeInUSD = 0;

        const buyerBalance = Number(buyer.walletBalance || 0);

        if (buyerBalance < totalAmountInUSD) {
          res.status(400).json({
            message: "Insufficient wallet balance for escrow payment.",
          });
          return;
        }

        // Deduct & freeze buyer funds
        const updatedBuyer = await User.findOneAndUpdate(
          { email: buyer?.email, walletBalance: { $gte: totalAmountInUSD } },
          {
            $inc: {
              walletBalance: -totalAmountInUSD,
              walletFrozeBalance: totalAmountInUSD,
            },
          },
          { new: true, session }
        );

        if (!updatedBuyer) {
          await session.abortTransaction();
          res.status(400).json({
            message:
              "Failed to deduct funds from buyer — possibly insufficient balance or concurrency issue.",
          });
          return;
        }

        isPaid = true;
      } else if (payerRole === "seller") {
        // Buyer creates but seller will pay fees
        buyerFeeInUSD = 0;
        sellerFeeInUSD = discountedFeeInUSD;
        isPaid = false; // No funds deducted yet
      } else if (payerRole === "split") {
        // Split payment - buyer pays amount + half fee immediately
        buyerFeeInUSD = discountedFeeInUSD / 2;
        sellerFeeInUSD = discountedFeeInUSD / 2;

        const buyerTotal = amountInUSD + buyerFeeInUSD;
        const buyerBalance = Number(buyer.walletBalance || 0);

        if (buyerBalance < buyerTotal) {
          res.status(400).json({
            message: "Insufficient wallet balance for split fee payment.",
          });
          return;
        }

        // Deduct from buyer only (amount + half fee)
        const updatedBuyer = await User.findOneAndUpdate(
          { email: buyerEmail, walletBalance: { $gte: buyerTotal } },
          {
            $inc: {
              walletBalance: -buyerTotal,
              walletFrozeBalance: buyerTotal,
            },
          },
          { new: true, session }
        );

        if (!updatedBuyer) {
          await session.abortTransaction();
          res.status(400).json({
            message: "Failed to deduct split fees — insufficient balance.",
          });
          return;
        }

        isPaid = false; // Not fully paid until seller pays their half
      }
    } else if (role === "seller" || role === "broker") {
      // Seller or broker creates the escrow
      if (payerRole === "buyer") {
        // Buyer will pay everything
        buyerFeeInUSD = discountedFeeInUSD;
        sellerFeeInUSD = 0;
        isPaid = false;
      } else if (payerRole === "seller") {
        // Seller will pay everything
        const totalAmountInUSD = amountInUSD + discountedFeeInUSD;
        buyerFeeInUSD = 0;
        sellerFeeInUSD = discountedFeeInUSD;

        const sellerBalance = Number(seller.walletBalance || 0);

        if (sellerBalance < totalAmountInUSD) {
          res.status(400).json({
            message: "Insufficient wallet balance for escrow payment.",
          });
          return;
        }

        // Deduct & freeze seller funds
        const updatedSeller = await User.findOneAndUpdate(
          { email: seller?.email, walletBalance: { $gte: totalAmountInUSD } },
          {
            $inc: {
              walletBalance: -totalAmountInUSD,
              walletFrozeBalance: totalAmountInUSD,
            },
          },
          { new: true, session }
        );

        if (!updatedSeller) {
          await session.abortTransaction();
          res.status(400).json({
            message:
              "Failed to deduct funds from seller — possibly insufficient balance or concurrency issue.",
          });
          return;
        }

        isPaid = true;
      } else if (payerRole === "split") {
        // Split payment - both parties pay their portions
        buyerFeeInUSD = discountedFeeInUSD / 2;
        sellerFeeInUSD = discountedFeeInUSD / 2;

        // Check both balances
        const buyerTotal = amountInUSD + buyerFeeInUSD;
        const sellerTotal = sellerFeeInUSD;

        const buyerBalance = Number(buyer.walletBalance || 0);
        const sellerBalance = Number(seller.walletBalance || 0);

        if (buyerBalance < buyerTotal || sellerBalance < sellerTotal) {
          res.status(400).json({
            message: "Insufficient wallet balance for split fee payment.",
          });
          return;
        }

        // Deduct from both parties
        const [updatedBuyer, updatedSeller] = await Promise.all([
          User.findOneAndUpdate(
            { email: buyerEmail, walletBalance: { $gte: buyerTotal } },
            {
              $inc: {
                walletBalance: -buyerTotal,
                walletFrozeBalance: buyerTotal,
              },
            },
            { new: true, session }
          ),
          User.findOneAndUpdate(
            { email: sellerEmail, walletBalance: { $gte: sellerTotal } },
            {
              $inc: {
                walletBalance: -sellerTotal,
                walletFrozeBalance: sellerTotal,
              },
            },
            { new: true, session }
          ),
        ]);

        if (!updatedBuyer || !updatedSeller) {
          await session.abortTransaction();
          res.status(400).json({
            message: "Failed to deduct split fees — insufficient balance.",
          });
          return;
        }

        isPaid = true;
      }
    }

    // 🧾 Create escrow transaction
    const [transaction] = await EscrowTransaction.create(
      [
        {
          buyerEmail,
          sellerEmail,
          brokerEmail: brokerEmail || null,
          brokerAmount: brokerAmount ? Number(brokerAmount) : 0,
          payerRole: payerRole || "buyer", // Use the provided payerRole or default to "buyer"
          item,
          description,
          amount: Number(amount),
          amountInUSD: amountInUSD,
          fee: Number(fee),
          feeInUSD: discountedFeeInUSD,
          buyerFeeInUSD,
          sellerFeeInUSD,
          currency,
          maxCheckTime,
          couponCode,
          claimCode,
          discountPercent:
            appliedCoupon && appliedCoupon?.discountPercent
              ? Number(appliedCoupon?.discountPercent)
              : 0,
          exchangeRate: currency.toUpperCase() === "KES" ? exchangeRate : null,
          isPaid,
          status: "new",
          joinedBy: [
            {
              email: req.user?.email || "",
              role,
              joinedAt: new Date(),
            },
          ],
        },
      ],
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    // Custom success message based on payment type
    let successMessage = "";
    if (isPaid) {
      if (payerRole === "split") {
        successMessage =
          "Escrow created with 50/50 fee split. Payment processed from both parties.";
      } else {
        successMessage = "Escrow created and payment successfully processed.";
      }
    } else {
      if (payerRole === "split") {
        successMessage =
          "Escrow created with 50/50 fee split. Awaiting payment from both parties.";
      } else {
        const awaitingPayer = payerRole === "seller" ? sellerEmail : buyerEmail;
        successMessage = `Escrow created successfully. Awaiting payment from ${awaitingPayer}.`;
      }
    }

    res.status(201).json({
      success: true,
      message: successMessage,
      transaction,
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    handleServerError(res, error, "Error creating escrow transaction");
  }
};

/**
 * @desc Get all escrow transactions (with filters and pagination)
 */
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

    // 🔍 Search by item name, description, or user email
    if (search) {
      const searchRegex = new RegExp(search as string, "i");
      filter.$or = [
        { _id: { $regex: searchRegex } },
        { item: searchRegex },
        { description: searchRegex },
        { buyerEmail: searchRegex },
        { sellerEmail: searchRegex },
        { brokerEmail: searchRegex },
      ];
    }

    // 📦 Fetch paginated transactions
    const transactions = await EscrowTransaction.find(filter)
      .skip((pageNumber - 1) * limitNumber)
      .limit(limitNumber)
      .sort({ updatedAt: -1, createdAt: -1 });

    const totalTransactions = await EscrowTransaction.countDocuments(filter);

    // 📊 Fetch status stats (same filter applied)
    const [newCount, inProgressCount, completedCount] = await Promise.all([
      EscrowTransaction.countDocuments({ ...filter, status: "new" }),
      EscrowTransaction.countDocuments({
        ...filter,
        status: { $in: ["started", "pending", "disputed"] }, // in-progress group
      }),
      EscrowTransaction.countDocuments({
        ...filter,
        status: { $in: ["completed", "resolved"] },
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

async function applyClaimCodeReward(
  user: any,
  claimCode: string,
  fee: number,
  session: any
) {
  if (!claimCode || !user?.claimCodes) return null;

  const claim = user.claimCodes.find(
    (c: any) =>
      c.code === claimCode && c.isActive && new Date(c.expiresAt) > new Date()
  );

  if (!claim) return null; // invalid or expired

  const reward = (fee * claim.percentage) / 100;

  // 💰 Add the user’s reward to their wallet
  user.walletBalance += reward;

  // Increment usage count
  claim.usageCount = (claim.usageCount || 0) + 1;

  // Disable if max usage reached
  if (claim.usageCount >= (claim.maxUsage || 1)) {
    claim.isActive = false;
  }

  await user.save({ session });

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
      User.findOne({ email: transaction.brokerEmail }).session(session),
      User.findOne({ email: requestingEmail }).session(session),
    ]);

    if (!seller || !buyer || !requestingUser) {
      await session.abortTransaction();
      res.status(404).json({ message: "User not found" });
      return;
    }

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

    // 🆕 Calculate total amounts based on fee payer type
    const getTotalAmounts = () => {
      const amountInUSD = transaction.amountInUSD || transaction.amount;
      const feeInUSD = transaction.feeInUSD || transaction.fee;

      if (transaction.payerRole === "split") {
        // For split payments, buyer pays amount + half fee
        const buyerTotal =
          amountInUSD + (transaction.buyerFeeInUSD || feeInUSD);
        const sellerTotal = transaction.sellerFeeInUSD || feeInUSD;
        return { buyerTotal, sellerTotal, totalAmount: amountInUSD + feeInUSD };
      } else {
        // For single payer
        const totalAmount = amountInUSD + feeInUSD;
        return {
          buyerTotal: totalAmount,
          sellerTotal: 0,
          totalAmount,
        };
      }
    };

    switch (status) {
      case "reopen": {
        // Only admin or participants (buyer) can reopen
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

        // Restore the transaction to "new" without wiping original data
        transaction.status = "new";
        transaction.isPaid = false;
        transaction.joinedBy = []; // Reset joinedBy array
        transaction.hasDispute = false;
        transaction.disputeReason = undefined;
        transaction.disputedBy = undefined;

        // Use findByIdAndUpdate to ensure the array is properly cleared
        const updatedTransaction = await EscrowTransaction.findByIdAndUpdate(
          transaction._id,
          {
            $set: {
              status: "new",
              isPaid: false,
              joinedBy: [], // Explicitly set empty array
              hasDispute: false,
              disputeReason: undefined,
              disputedBy: undefined,
              updatedAt: new Date(),
            },
          },
          { new: true, session }
        );

        if (!updatedTransaction) {
          await session.abortTransaction();
          res.status(500).json({
            message: "Failed to reopen transaction",
          });
          return;
        }

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

        // Debug: Log the current joinedBy array
        console.log("Before join - joinedBy:", transaction.joinedBy);
        console.log("Requesting email:", requestingEmail);
        console.log("Transaction ID:", transaction._id);

        // Ensure joinedBy is an array
        if (!Array.isArray(transaction.joinedBy)) {
          transaction.joinedBy = [];
        }

        const alreadyJoined = transaction.joinedBy.some(
          (p) => p.email === requestingEmail
        );

        console.log("Already joined check:", alreadyJoined);

        if (alreadyJoined) {
          await session.abortTransaction();
          res
            .status(400)
            .json({ message: `${role} has already joined this transaction` });
          return;
        }

        const { buyerTotal, totalAmount } = getTotalAmounts();

        if (!transaction.isPaid) {
          // 🆕 Handle payment based on payer role
          if (transaction.payerRole === "split") {
            // For split payments, only buyer pays upfront
            if (buyer.walletBalance < buyerTotal) {
              await session.abortTransaction();
              res.status(400).json({
                message: "Insufficient buyer balance for split fee payment",
              });
              return;
            }

            // Deduct only from buyer for split payments
            buyer.walletBalance -= buyerTotal;
            buyer.walletFrozeBalance += buyerTotal;

            await logEscrowFunding(
              buyer.email,
              transaction.amount,
              transaction.buyerFeeInUSD || 0,
              escrowTransactionId,
              { ...participants, payer: "split-buyer" },
              session
            );

            await buyer.save({ session });
          } else {
            // Single payer
            const payerRole = transaction.payerRole || "buyer";
            const payer = payerRole === "buyer" ? buyer : seller;

            if (!payer) {
              await session.abortTransaction();
              res
                .status(400)
                .json({ message: "Invalid payer role configuration" });
              return;
            }

            if (payer.walletBalance < totalAmount) {
              await session.abortTransaction();
              res.status(400).json({
                message: `${payerRole} has insufficient balance to fund escrow.`,
              });
              return;
            }

            payer.walletBalance -= totalAmount;
            payer.walletFrozeBalance += totalAmount;

            await logEscrowFunding(
              payer.email,
              transaction.amount,
              transaction.feeInUSD || transaction.fee,
              escrowTransactionId,
              participants,
              session
            );

            await payer.save({ session });
          }

          transaction.isPaid = true;
        }

        // Add the user to joinedBy
        const newParticipant = {
          email: requestingEmail,
          role,
          joinedAt: new Date(),
        };

        transaction.joinedBy.push(newParticipant);

        console.log("After join - joinedBy:", transaction.joinedBy);

        const joinedRoles = transaction.joinedBy.map((p) => p.role);
        if (joinedRoles.includes("buyer") && joinedRoles.includes("seller")) {
          transaction.status = "started";
        }

        // Use findByIdAndUpdate to ensure the array is properly updated
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

        if (!updatedTransaction) {
          await session.abortTransaction();
          res.status(500).json({
            message: "Failed to join transaction",
          });
          return;
        }

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
        // 🆕 Calculate amounts WITHOUT fees for cancellation
        const getCancellationAmounts = () => {
          const amountInUSD = transaction.amountInUSD || transaction.amount;

          if (transaction.payerRole === "split") {
            // For split payments, buyer only gets amount back (no fee refund)
            const buyerRefund = amountInUSD;
            return { buyerRefund, totalRefund: amountInUSD };
          } else {
            // For single payer, only refund the amount (no fees)
            return {
              buyerRefund: amountInUSD,
              sellerRefund: 0,
              totalRefund: amountInUSD,
            };
          }
        };

        const { buyerRefund, totalRefund } = getCancellationAmounts();

        // 🆕 Allow buyer to cancel if not all parties have joined
        const joinedRoles = transaction.joinedBy?.map((p) => p.role) || [];
        const allPartiesJoined =
          joinedRoles.includes("buyer") && joinedRoles.includes("seller");

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

        // 🆕 Only check seller/broker funds if transaction was approved (funds were released)
        let sellerRefund = 0;
        let brokerRefund = 0;

        if (transaction.status === "approved") {
          // Transaction was approved, funds were released to seller - need to recover
          const sellerOwes = transaction.brokerEmail
            ? transaction.amount - (transaction.brokerAmount || 0)
            : transaction.amount;
          const brokerOwes = transaction.brokerAmount || 0;

          if (seller.walletBalance >= sellerOwes) {
            seller.walletBalance -= sellerOwes;
            sellerRefund = sellerOwes;
          } else if (seller.walletBalance < sellerOwes) {
            sellerRefund = seller.walletBalance;
            seller.walletBalance = 0;
          }

          let broker;
          if (transaction.brokerEmail) {
            broker = await User.findOne({
              email: transaction.brokerEmail,
            }).session(session);
            if (broker) {
              if (broker.walletBalance >= brokerOwes) {
                broker.walletBalance -= brokerOwes;
                brokerRefund = brokerOwes;
              } else if (broker.walletBalance < brokerOwes) {
                brokerRefund = broker.walletBalance;
                broker.walletBalance = 0;
              }
              await broker.save({ session });
            }
          }
        }

        const totalRefundRecovered = sellerRefund + brokerRefund;

        // 🆕 Only check for insufficient funds if transaction was approved and funds need recovery
        if (transaction.status === "approved" && totalRefundRecovered <= 0) {
          await session.abortTransaction();
          res.status(400).json({
            success: false,
            message:
              "Refund failed: both Seller and Broker have insufficient funds.",
          });
          return;
        }

        // 🆕 Handle refund based on payer role - ONLY REFUND PRINCIPAL AMOUNT
        if (transaction.payerRole === "split") {
          // For split payments, refund only principal amount to buyer (no fees)
          buyer.walletBalance += buyerRefund;
          buyer.walletFrozeBalance -=
            (transaction.amountInUSD || transaction.amount) +
            (transaction.buyerFeeInUSD || 0);

          await logEscrowRefund(
            buyer.email,
            buyerRefund,
            escrowTransactionId,
            {
              ...participants,
              payer: "split-buyer",
              refundType: "principal_only",
            },
            session
          );

          await buyer.save({ session });
        } else {
          // Single payer refund - only refund principal amount
          const payerRole = transaction.payerRole || "buyer";
          const payer = payerRole === "buyer" ? buyer : seller;

          const refundAmount =
            transaction.status === "approved"
              ? totalRefundRecovered
              : totalRefund;

          payer.walletBalance += refundAmount;
          payer.walletFrozeBalance -=
            (transaction.amountInUSD || transaction.amount) +
            (transaction.feeInUSD || transaction.fee);

          await logEscrowRefund(
            payer.email,
            refundAmount,
            escrowTransactionId,
            { ...participants, refundType: "principal_only" },
            session
          );

          await payer.save({ session });
        }

        transaction.status = "cancelled";

        await Promise.all([
          seller.save({ session }),
          transaction.save({ session }),
        ]);

        await session.commitTransaction();

        // 🆕 Different messages based on whether funds were released
        let refundMsg = "";
        const status = transaction.status as
          | "approved"
          | "cancelled"
          | "pending";

        if (status === "approved") {
          refundMsg =
            totalRefundRecovered < transaction.amount
              ? `Transaction cancelled — partial refund of $${totalRefundRecovered} recovered out of $${transaction.amount}.`
              : "Transaction cancelled and funds refunded successfully.";
        } else {
          refundMsg =
            "Transaction cancelled successfully. All frozen funds have been refunded.";
        }

        res.status(200).json({
          success: true,
          message: refundMsg,
          refunded: status === "approved" ? totalRefundRecovered : totalRefund,
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

        const { buyerTotal, totalAmount } = getTotalAmounts();

        let sellerAmount = transaction.amount;
        if (transaction.brokerEmail && transaction.brokerAmount) {
          sellerAmount -= transaction.brokerAmount;

          const broker = await User.findOne({
            email: transaction.brokerEmail,
          }).session(session);
          if (broker) {
            broker.walletBalance += transaction.brokerAmount;

            await logBrokerCommission(
              broker.email,
              transaction.brokerAmount,
              escrowTransactionId,
              participants,
              session
            );

            await broker.save({ session });
          }
        }

        // 🆕 Handle seller fee deduction for split payments on successful transaction
        if (transaction.payerRole === "split") {
          const sellerFee =
            transaction.sellerFeeInUSD ||
            (transaction.feeInUSD || transaction.fee) / 2;

          if (seller.walletBalance >= sellerFee) {
            // Deduct seller's fee portion
            seller.walletBalance -= sellerFee;

            await logSellerFeeDeduction(
              seller.email,
              sellerFee,
              escrowTransactionId,
              participants,
              session
            );
          }
          // If seller doesn't have enough balance, proceed without deducting (graceful handling)
        }

        let claimResult = null;
        let feeAfterClaim = transaction.feeInUSD || transaction.fee;

        if (transaction.claimCode) {
          const claimOwner = await User.findOne({
            "claimCodes.code": transaction.claimCode,
            "claimCodes.isActive": true,
            "claimCodes.expiresAt": { $gt: new Date() },
          }).session(session);

          if (claimOwner) {
            const claimResponse = await applyClaimCodeReward(
              claimOwner,
              transaction.claimCode,
              transaction.feeInUSD || transaction.fee,
              session
            );

            if (claimResponse) {
              claimResult = claimResponse;
              feeAfterClaim = Math.max(
                (transaction.feeInUSD || transaction.fee) -
                  claimResponse.reward,
                0
              );
              transaction.feeInUSD = feeAfterClaim;

              await logClaimReward(
                claimOwner.email,
                claimResponse.reward,
                transaction.claimCode,
                escrowTransactionId,
                session
              );

              transaction.claimApplied = {
                ...claimResponse,
                claimedBy: claimOwner.email,
              };
            }
          }
        }

        seller.walletBalance += sellerAmount;
        await logEscrowReleaseToSeller(
          seller.email,
          sellerAmount,
          escrowTransactionId,
          participants,
          session
        );

        // 🆕 Handle frozen balance release based on payer role
        if (transaction.payerRole === "split") {
          // Only release buyer's frozen balance (seller didn't freeze any funds)
          buyer.walletFrozeBalance -= buyerTotal;
          await buyer.save({ session });
        } else {
          const payerRole = transaction.payerRole || "buyer";
          const payer = payerRole === "buyer" ? buyer : seller;
          payer.walletFrozeBalance -= totalAmount;
          await payer.save({ session });
        }

        transaction.status = "approved";
        transaction.claimApplied = claimResult || null;

        break;
      }

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

        if (isBuyer) {
          seller.hasDispute = true;
          await seller.save({ session });
        } else if (isSeller) {
          buyer.hasDispute = true;
          await buyer.save({ session });
        } else if (isBroker) {
          const { flag } = req.body;
          if (flag === "buyer" || flag === "both") {
            buyer.hasDispute = true;
            await buyer.save({ session });
          }
          if (flag === "seller" || flag === "both") {
            seller.hasDispute = true;
            await seller.save({ session });
          }
        } else if (isAdmin) {
          const { flag } = req.body;
          if (flag === "buyer" || flag === "all") {
            buyer.hasDispute = true;
            await buyer.save({ session });
          }
          if (flag === "seller" || flag === "all") {
            seller.hasDispute = true;
            await seller.save({ session });
          }
          if (
            (flag === "broker" || flag === "all") &&
            transaction.brokerEmail
          ) {
            const broker = await User.findOne({
              email: transaction.brokerEmail,
            }).session(session);
            if (broker) {
              broker.hasDispute = true;
              await broker.save({ session });
            }
          }
        }

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

        const { unflag } = req.body;

        if (unflag === "buyer" || unflag === "all") {
          buyer.hasDispute = false;
          await buyer.save({ session });
        }
        if (unflag === "seller" || unflag === "all") {
          seller.hasDispute = false;
          await seller.save({ session });
        }
        if (
          (unflag === "broker" || unflag === "all") &&
          transaction.brokerEmail
        ) {
          const broker = await User.findOne({
            email: transaction.brokerEmail,
          }).session(session);
          if (broker) {
            broker.hasDispute = false;
            await broker.save({ session });
          }
        }

        transaction.hasDispute = false;
        transaction.status = "resolved";
        transaction.disputeReason = undefined;
        transaction.disputedBy = undefined;

        break;
      }

      default:
        await session.abortTransaction();
        res.status(400).json({ message: "Invalid status update" });
        return;
    }

    await Promise.all([
      broker && broker.save({ session }),
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
): Promise<void> => {
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
      maxCheckTime,
      claimCode,
      status,
      isPaid,
    } = req.body;

    // ✅ Find the existing transaction
    const existingTransaction = await EscrowTransaction.findById(transactionId);
    if (!existingTransaction) {
      res.status(404).json({
        message: "Escrow transaction not found.",
      });
      return;
    }

    // ✅ Check if transaction can be edited (prevent editing completed/cancelled disputes)
    if (
      ["completed", "cancelled", "disputed"].includes(
        existingTransaction.status
      )
    ) {
      res.status(400).json({
        message: `Cannot edit transaction with status: ${existingTransaction.status}`,
      });
      return;
    }

    // ✅ Validate currency if provided
    if (currency && !["USD", "KES"].includes(currency.toUpperCase())) {
      res.status(400).json({
        message: "Currency must be either USD or KES",
      });
      return;
    }

    // ✅ Validate payerRole if provided
    if (payerRole && !["buyer", "seller", "split"].includes(payerRole)) {
      res.status(400).json({
        message: "payerRole must be 'buyer', 'seller', or 'split'",
      });
      return;
    }

    // ✅ Validate status if provided
    const allowedStatuses = [
      "new",
      "pending",
      "in_progress",
      "completed",
      "cancelled",
      "disputed",
    ];
    if (status && !allowedStatuses.includes(status)) {
      res.status(400).json({
        message: `Status must be one of: ${allowedStatuses.join(", ")}`,
      });
      return;
    }

    // 🔍 Fetch users if emails are being updated
    let buyer, seller, broker;
    if (buyerEmail || sellerEmail || brokerEmail) {
      const [buyerRaw, sellerRaw, brokerRaw] = await Promise.all([
        buyerEmail
          ? User.findOne({ email: buyerEmail })
          : User.findOne({ email: existingTransaction.buyerEmail }),
        sellerEmail
          ? User.findOne({ email: sellerEmail })
          : User.findOne({ email: existingTransaction.sellerEmail }),
        brokerEmail
          ? User.findOne({ email: brokerEmail })
          : existingTransaction.brokerEmail
          ? User.findOne({ email: existingTransaction.brokerEmail })
          : null,
      ]);

      if (
        (buyerEmail && !buyerRaw) ||
        (sellerEmail && !sellerRaw) ||
        (brokerEmail && !brokerRaw)
      ) {
        res.status(404).json({
          message: `User not found: ${
            !buyerRaw ? "buyer" : !sellerRaw ? "seller" : "broker"
          }`,
        });
        return;
      }

      // Ensure wallet fields exist
      buyer = buyerRaw ? await ensureFields(buyerRaw, session) : null;
      seller = sellerRaw ? await ensureFields(sellerRaw, session) : null;
      broker = brokerRaw ? await ensureFields(brokerRaw, session) : null;

      // 🧠 Dispute checks for new participants
      if (
        (buyerEmail && buyer?.hasDispute) ||
        (sellerEmail && seller?.hasDispute) ||
        (brokerEmail && broker?.hasDispute)
      ) {
        res.status(403).json({
          message:
            "Transaction update denied. One or more participants have an active dispute.",
        });
        return;
      }
    }

    // 🔹 Hardcoded coupons array
    const HARDCODED_COUPONS = [
      { code: "XWADDA", discountPercent: 50 },
      { code: "DISCUSSION", discountPercent: 50 },
    ];

    // 🔹 Determine discount based on incoming couponCode
    let appliedCoupon: { code: string; discountPercent: number } | null = null;
    let discountPercent = existingTransaction.discountPercent;
    let feeInUSD = existingTransaction.feeInUSD;

    if (couponCode !== undefined) {
      if (couponCode) {
        const found = HARDCODED_COUPONS.find(
          (c) => c.code.toUpperCase() === couponCode.toUpperCase()
        );

        if (!found) {
          await session.abortTransaction();
          res.status(400).json({ message: "Invalid or expired coupon code" });
          return;
        }

        appliedCoupon = found;
        discountPercent = appliedCoupon.discountPercent;
      } else {
        // couponCode is empty string or null - remove discount
        discountPercent = 0;
        appliedCoupon = null;
      }
    }

    // 💰 Recalculate amounts if amount, fee, currency, or coupon changed
    const numericAmount =
      amount !== undefined ? Number(amount) : existingTransaction.amount;
    const numericFee =
      fee !== undefined ? Number(fee) : existingTransaction.fee;
    const currentCurrency = currency || existingTransaction.currency;

    // Convert amounts to USD for wallet operations
    const amountInUSD = convertToUSD(numericAmount, currentCurrency);

    if (
      fee !== undefined ||
      couponCode !== undefined ||
      currency !== undefined
    ) {
      const baseFeeInUSD = convertToUSD(numericFee, currentCurrency);
      feeInUSD =
        discountPercent || 0 > 0
          ? baseFeeInUSD * ((100 - (discountPercent || 0)) / 100)
          : baseFeeInUSD;
    }

    // 💰 Handle financial updates and wallet adjustments
    if (
      amount !== undefined ||
      fee !== undefined ||
      currency !== undefined ||
      buyerEmail !== undefined ||
      sellerEmail !== undefined ||
      payerRole !== undefined
    ) {
      await handleFinancialUpdates(
        existingTransaction,
        {
          buyerEmail: buyerEmail || existingTransaction.buyerEmail,
          sellerEmail: sellerEmail || existingTransaction.sellerEmail,
          amount: numericAmount,
          fee: numericFee,
          amountInUSD,
          feeInUSD,
          payerRole: payerRole || existingTransaction.payerRole,
          currency: currentCurrency,
        },
        session
      );
    }

    // 🧾 Build update object
    const updateData: any = {
      ...(buyerEmail !== undefined && { buyerEmail }),
      ...(sellerEmail !== undefined && { sellerEmail }),
      ...(brokerEmail !== undefined && { brokerEmail }),
      ...(brokerAmount !== undefined && { brokerAmount: Number(brokerAmount) }),
      ...(item !== undefined && { item }),
      ...(description !== undefined && { description }),
      ...(amount !== undefined && { amount: numericAmount }),
      ...(fee !== undefined && { fee: numericFee }),
      ...(payerRole !== undefined && { payerRole }),
      ...(currency !== undefined && { currency }),
      ...(maxCheckTime !== undefined && { maxCheckTime }),
      ...(couponCode !== undefined && { couponCode }),
      ...(claimCode !== undefined && { claimCode }),
      ...(status !== undefined && { status }),
      ...(isPaid !== undefined && { isPaid }),
    };

    // Update calculated fields if they changed
    if (amount !== undefined || currency !== undefined) {
      updateData.amountInUSD = amountInUSD;
      updateData.exchangeRate =
        currentCurrency.toUpperCase() === "KES" ? exchangeRate : null;
    }

    if (
      fee !== undefined ||
      couponCode !== undefined ||
      currency !== undefined
    ) {
      updateData.feeInUSD = feeInUSD;
      updateData.discountPercent = discountPercent;
    }

    // Update timestamps
    updateData.updatedAt = new Date();

    // ✅ Update the transaction
    const updatedTransaction = await EscrowTransaction.findByIdAndUpdate(
      transactionId,
      updateData,
      { new: true, session, runValidators: true }
    );

    if (!updatedTransaction) {
      await session.abortTransaction();
      res.status(404).json({
        message: "Failed to update escrow transaction",
      });
      return;
    }

    await session.commitTransaction();
    session.endSession();

    res.status(200).json({
      success: true,
      message: "Escrow transaction updated successfully",
      transaction: updatedTransaction,
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    handleServerError(res, error, "Error updating escrow transaction");
  }
};

// Helper function to handle financial updates and wallet adjustments
const handleFinancialUpdates = async (
  existingTransaction: any,
  newData: {
    buyerEmail: string;
    sellerEmail: string;
    amount: number;
    fee: number;
    amountInUSD: number;
    feeInUSD: number;
    payerRole: string;
    currency: string;
  },
  session: mongoose.ClientSession
) => {
  const {
    buyerEmail,
    sellerEmail,
    amount,
    fee,
    amountInUSD,
    feeInUSD,
    payerRole,
    currency,
  } = newData;

  // If financial details changed, we need to adjust wallet balances
  const amountChanged = amount !== existingTransaction.amount;
  const feeChanged = fee !== existingTransaction.fee;
  const currencyChanged = currency !== existingTransaction.currency;
  const payerRoleChanged = payerRole !== existingTransaction.payerRole;
  const participantsChanged =
    buyerEmail !== existingTransaction.buyerEmail ||
    sellerEmail !== existingTransaction.sellerEmail;

  if (
    amountChanged ||
    feeChanged ||
    currencyChanged ||
    payerRoleChanged ||
    participantsChanged
  ) {
    // 1. First, refund any existing frozen amounts to original participants
    if (existingTransaction.isPaid) {
      await refundFrozenAmounts(existingTransaction, session);
    }

    // 2. Then, calculate and deduct new amounts if isPaid was true
    if (existingTransaction.isPaid) {
      await deductNewAmounts(existingTransaction, newData, session);
    }
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

    // 🔍 Find transaction first
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

    // 🗑️ Proceed to delete
    await EscrowTransaction.findByIdAndDelete(id);

    res.json({
      success: true,
      message: "Escrow transaction deleted successfully.",
    });
    return;
  } catch (error) {
    handleServerError(res, error, "Error deleting escrow transaction");
  }
};

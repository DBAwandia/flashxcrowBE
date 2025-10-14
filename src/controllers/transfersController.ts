import Transfers from "../model/transfersModel";
import User from "../model/userModel";
import {
  getSubUsersService,
  updateSubUserService,
} from "../services/proxyService";
import { bytesToGB, gbToBytes } from "../utils/gigaBytesConvertor";
import { handleServerError } from "../utils/handleServerError";

import { Request, Response } from "express";

export const getAllTransfers = async (req: Request, res: Response) => {
  try {
    const { page = "1", limit = "50", search } = req.query;

    const pageNumber = parseInt(page as string);
    const limitNumber = parseInt(limit as string);
    const user = (req as any).user;

    if (!user || !user.email) {
      res.status(401).json({ message: "Unauthorized access" });
      return;
    }

    const isAdmin = user.isAdmin;
    const sessionEmail = user.email;

    const searchRegex = search ? new RegExp(search as string, "i") : null;

    let filter: any = {};

    if (isAdmin) {
      // Admin: apply search globally
      if (searchRegex) {
        filter.$or = [
          { fromEmail: { $regex: searchRegex } },
          { toEmail: { $regex: searchRegex } },
        ];
      }
    } else {
      // Normal user: restrict to their transfers
      if (searchRegex) {
        // Search only within their own transfers
        filter.$or = [
          { fromEmail: sessionEmail, toEmail: { $regex: searchRegex } },
          { toEmail: sessionEmail, fromEmail: { $regex: searchRegex } },
        ];
      } else {
        filter.$or = [{ fromEmail: sessionEmail }, { toEmail: sessionEmail }];
      }
    }

    const totalTransfers = await Transfers.countDocuments(filter);

    const transfers = await Transfers.find(filter)
      .sort({ createdAt: -1 })
      .skip((pageNumber - 1) * limitNumber)
      .limit(limitNumber)
      .lean();

    res.status(200).json({
      success: true,
      totalTransfers,
      page: pageNumber,
      totalPages: Math.ceil(totalTransfers / limitNumber),
      transfers,
    });
  } catch (error) {
    handleServerError(res, error, "Failed to fetch transfers with pagination");
  }
};

// Transfer traffic
export const transferTraffic = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { fromEmail, toEmail, amountGB, reverse = false } = req.body;

    const user = (req as any).user;

    if (!user || !user.email) {
      res.status(401).json({ message: "Unauthorized access" });
      return;
    }

    const sessionEmail = user.email;

    // Validate input parameters
    if (!fromEmail || !toEmail || isNaN(amountGB) || amountGB <= 0) {
      res.status(400).json({ message: "Invalid request parameters" });
      return;
    }

    // Find both users
    const [fromUser, toUser] = await Promise.all([
      User.findOne({ email: fromEmail }),
      User.findOne({ email: toEmail }),
    ]);

    if (!fromUser || !toUser) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    // Get subuser data
    const [fromUserSub, toUserSub] = await Promise.all([
      getSubUsersService(fromUser.subUserId),
      getSubUsersService(toUser.subUserId),
    ]);

    if (!fromUserSub || !toUserSub) {
      res.status(500).json({ message: "Error fetching user data" });
      return;
    }

    // Calculate available balances
    const fromAvailable =
      fromUserSub.payload.traffic_limit - fromUserSub.payload.used_traffic;
    const toAvailable =
      toUserSub.payload.traffic_limit - toUserSub.payload.used_traffic;
    const transferBytes = gbToBytes(amountGB);
    let reversibleBytes = transferBytes;

    // Handle regular transfer
    if (!reverse) {
      if (fromAvailable < transferBytes) {
        res.status(400).json({
          message: `Insufficient data to transfer. Available: ${bytesToGB(
            fromAvailable
          )}GB`,
        });
        return;
      }
    }
    // Handle reversal
    else {
      if (toAvailable <= 0) {
        res.status(400).json({
          message: "Cannot reverse — data has already been utilized.",
        });
        return;
      }

      if (transferBytes > toAvailable) {
        reversibleBytes = toAvailable; // Only reverse what's left
      }
    }

    // Calculate new limits
    const newFromLimit = reverse
      ? fromAvailable + reversibleBytes
      : fromAvailable - reversibleBytes;

    const newToLimit = reverse
      ? toAvailable - reversibleBytes
      : toAvailable + reversibleBytes;

    // Update both users in parallel
    const [fromResponse, toResponse] = await Promise.all([
      updateSubUserService(fromUser.subUserId as string, {
        used_traffic: 0,
        traffic_limit: newFromLimit,
      }),
      updateSubUserService(toUser.subUserId as string, {
        used_traffic: 0,
        traffic_limit: newToLimit,
      }),
    ]);

    if (
      Object.keys(fromResponse.errors).length > 0 ||
      Object.keys(toResponse.errors).length > 0
    ) {
      res
        .status(500)
        .json({ message: "Error updating user balances, try again" });
      return;
    }

    // Update user balances and create transfer record
    await Promise.all([
      User.findOneAndUpdate(
        { email: fromEmail },
        { $set: { balance: bytesToGB(newFromLimit) } }
      ),
      User.findOneAndUpdate(
        { email: toEmail },
        { $set: { balance: bytesToGB(newToLimit) } }
      ),
      // Create transfer record
      Transfers.create({
        fromEmail: fromUser.email,
        toEmail: toUser.email,
        amount: bytesToGB(reversibleBytes),
        reverse,
        type: sessionEmail === fromUser?.email ? "Sent" : "Received",
        timestamp: new Date(),
      }),
    ]);

    res.status(200).json({
      success: true,
      message: reverse ? "Transfer reversed" : "Transfer completed",
      transferred: bytesToGB(reversibleBytes),
      fromNewBalance: bytesToGB(newFromLimit),
      toNewBalance: bytesToGB(newToLimit),
    });
    return;
  } catch (error) {
    handleServerError(res, error, "Transfer failed");
  }
};

export const reversalTransfer = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { transferId } = req.params;

    // Validate input
    if (!transferId) {
      res.status(400).json({ message: "Transfer ID is required" });
      return;
    }

    // Find and validate original transfer
    const transfer = await Transfers.findById(transferId);
    if (!transfer) {
      res.status(404).json({ message: "Transfer not found" });
      return;
    }
    if (transfer.reverse) {
      res.status(400).json({ message: "Transfer already reversed" });
      return;
    }

    // Check time window (10 minutes)
    const now = new Date();
    const minutesDiff =
      (now.getTime() - transfer.createdAt.getTime()) / (1000 * 60);
    if (minutesDiff > 20) {
      res.status(400).json({
        message: "Reversal window expired (20 minutes)",
      });
      return;
    }

    // Find both users (note reversed sender/receiver)
    const [originalSender, originalReceiver] = await Promise.all([
      User.findOne({ email: transfer.fromEmail }),
      User.findOne({ email: transfer.toEmail }),
    ]);

    if (!originalSender || !originalReceiver) {
      res
        .status(404)
        .json({ message: "This transaction is not eligible for reversal." });
      return;
    }

    // Get subuser data
    const [receiverSub, senderSub] = await Promise.all([
      getSubUsersService(originalReceiver.subUserId), // Original receiver
      getSubUsersService(originalSender.subUserId), // Original sender
    ]);

    if (!senderSub || !receiverSub) {
      res.status(500).json({ message: "Error fetching user data" });
      return;
    }

    // Calculate available balance for reversal
    const receiverAvailable =
      receiverSub.payload.traffic_limit - receiverSub.payload.used_traffic;
    const transferBytes = gbToBytes(transfer.amount); // Can only reverse full original amount

    if (receiverAvailable < transferBytes) {
      res.status(400).json({
        message: `Cannot reverse. Receiver only has ${bytesToGB(
          receiverAvailable
        )}GB available`,
        originalAmount: transfer.amount,
        availableToReverse: bytesToGB(receiverAvailable),
      });
      return;
    }

    // Calculate new limits
    const newReceiverLimit = receiverSub.payload.traffic_limit - transferBytes;
    const newSenderLimit = senderSub.payload.traffic_limit + transferBytes;

    // Update both users in parallel
    const [receiverResponse, senderResponse] = await Promise.all([
      updateSubUserService(originalReceiver.subUserId as string, {
        used_traffic: 0,
        traffic_limit: newReceiverLimit,
      }),
      updateSubUserService(originalSender.subUserId as string, {
        used_traffic: 0,
        traffic_limit: newSenderLimit,
      }),
    ]);

    if (
      Object.keys(receiverResponse.errors).length > 0 ||
      Object.keys(senderResponse.errors).length > 0
    ) {
      res
        .status(500)
        .json({ message: "Error updating user balances, try again" });
      return;
    }

    // Update the original transfer record
    const updatedTransfer = await Transfers.findByIdAndUpdate(
      transferId,
      {
        $set: {
          reverse: true,
          updatedAt: new Date(),
        },
      },
      { new: true }
    );

    // Update user balances
    await Promise.all([
      User.findOneAndUpdate(
        { email: transfer.toEmail },
        { $set: { balance: bytesToGB(newReceiverLimit) } }
      ),
      User.findOneAndUpdate(
        { email: transfer.fromEmail },
        { $set: { balance: bytesToGB(newSenderLimit) } }
      ),
    ]);

    res.status(200).json({
      success: true,
      message: "Transfer reversed successfully",
      transfer: updatedTransfer,
      reversedAmount: transfer.amount, // Full original amount
      senderNewBalance: bytesToGB(newSenderLimit),
      receiverNewBalance: bytesToGB(newReceiverLimit),
    });
  } catch (error) {
    handleServerError(res, error, "Reversal failed");
  }
};

export const deleteTransfer = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { transferId } = req.params;
    const user = (req as any).user;

    if (!user?.isAdmin) {
      res.status(403).json({ message: "Forbidden: Admin access required" });
      return;
    }

    const deleted = await Transfers.findByIdAndDelete(transferId);

    if (!deleted) {
      res.status(404).json({ message: "Transfer not found" });
      return;
    }

    res.status(200).json({
      success: true,
      message: "Transfer deleted successfully",
      deletedTransferId: transferId,
    });
  } catch (error) {
    handleServerError(res, error, "Failed to delete transfer");
  }
};

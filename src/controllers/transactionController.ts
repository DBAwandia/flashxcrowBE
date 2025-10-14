import { Request, Response } from "express";
import Transaction from "../model/transactionModel";
import User from "../model/userModel";
import { handleServerError } from "../utils/handleServerError";
import moment from "moment-timezone";
import mongoose from "mongoose";

// Define a custom interface to extend the Request type
declare module "express" {
  interface Request {
    user?: {
      id: string;
      isAdmin: boolean;
      // Add other user properties as needed
    };
  }
}

const PROFIT_PER_GB: number = 1; // Fixed profit per GB

export const getProfits = async (req: Request, res: Response) => {
  const timePeriod = (req.query.timePeriod as string) || "Last 7 Days"; // Default to Last 7 Days
  const timezone = (req.query.timezone as string) || "Africa/Nairobi"; // Default to Africa/Nairobi

  try {
    const now = moment().tz(timezone); // e.g., "Africa/Nairobi"

    let startDate: moment.Moment;
    let endDate = now.clone().endOf("day");
    let comparisonStartDate: moment.Moment;
    let comparisonEndDate: moment.Moment;
    let comparisonLabel = "";

    // Set date ranges based on time period label
    switch (timePeriod) {
      case "Today":
        startDate = now.clone().startOf("day");
        endDate = now.clone().endOf("day");
        comparisonStartDate = now.clone().subtract(1, "day").startOf("day");
        comparisonEndDate = now.clone().subtract(1, "day").endOf("day");
        comparisonLabel = "Yesterday";
        break;

      case "Yesterday":
        startDate = now.clone().subtract(1, "day").startOf("day");
        endDate = now.clone().subtract(1, "day").endOf("day");
        comparisonStartDate = now.clone().subtract(2, "days").startOf("day");
        comparisonEndDate = now.clone().subtract(2, "days").endOf("day");
        comparisonLabel = "Day Before Yesterday";
        break;

      case "Last 7 Days":
        startDate = now.clone().subtract(7, "days").startOf("day");
        endDate = now.clone().endOf("day");
        comparisonStartDate = now.clone().subtract(14, "days").startOf("day");
        comparisonEndDate = now.clone().subtract(7, "days").endOf("day");
        comparisonLabel = "Previous 7 Days";
        break;

      case "This Month":
        startDate = now.clone().startOf("month");
        endDate = now.clone().endOf("day");
        comparisonStartDate = now.clone().subtract(1, "month").startOf("month");
        comparisonEndDate = now.clone().subtract(1, "month").endOf("month");
        comparisonLabel = "Last Month";
        break;

      case "Last Month":
        startDate = now.clone().subtract(1, "month").startOf("month");
        endDate = now.clone().subtract(1, "month").endOf("month");
        comparisonStartDate = now
          .clone()
          .subtract(2, "months")
          .startOf("month");
        comparisonEndDate = now.clone().subtract(2, "months").endOf("month");
        comparisonLabel = "Previous Last Month";
        break;

      case "This Year":
        startDate = now.clone().startOf("year");
        endDate = now.clone().endOf("day");
        comparisonStartDate = now.clone().subtract(1, "year").startOf("year");
        comparisonEndDate = now.clone().subtract(1, "year").endOf("year");
        comparisonLabel = "Last Year";
        break;

      case "Last Year":
        startDate = now.clone().subtract(1, "year").startOf("year");
        endDate = now.clone().subtract(1, "year").endOf("year");
        comparisonStartDate = now.clone().subtract(2, "years").startOf("year");
        comparisonEndDate = now.clone().subtract(2, "years").endOf("year");
        comparisonLabel = "Previous Last Year";
        break;

      case "All Time":
        startDate = moment("2000-01-01"); // or any earliest date possible
        endDate = now.clone().endOf("day");
        comparisonStartDate = startDate.clone();
        comparisonEndDate = startDate.clone(); // irrelevant, but keep valid
        comparisonLabel = "N/A";
        break;

      default:
        res.status(400).json({ message: "Invalid time period label" });
        return;
    }

    // Fetch current period transactions
    const transactions = await Transaction.find({
      createdAt: { $gte: startDate.toDate(), $lte: endDate.toDate() },
      transactionStatus: "paid",
    });

    // Fetch comparison period transactions
    const prevTransactions = await Transaction.find({
      createdAt: {
        $gte: comparisonStartDate.toDate(),
        $lte: comparisonEndDate.toDate(),
      },
      transactionStatus: "paid",
    });

    // Calculate metrics for current period
    const totalProfit = transactions.reduce(
      (sum, txn) => sum + PROFIT_PER_GB * txn.amountGB,
      0
    );
    const totalTransactionAmount = transactions.reduce(
      (sum, txn) => sum + (txn.transactionAmount ?? txn?.amount ?? 0),
      0
    );
    const totalAmountGB = transactions.reduce(
      (sum, txn) => sum + txn.amountGB,
      0
    );

    // Calculate metrics for comparison period
    const prevTotalProfit = prevTransactions.reduce(
      (sum, txn) => sum + PROFIT_PER_GB * txn.amountGB,
      0
    );
    const prevTotalTransactionAmount = prevTransactions.reduce(
      (sum, txn) => sum + (txn.transactionAmount ?? txn?.amount ?? 0),
      0
    );
    const prevTotalAmountGB = prevTransactions.reduce(
      (sum, txn) => sum + txn.amountGB,
      0
    );

    // Function to calculate percentage change with formatting
    const getPercentageChange = (current: number, previous: number) => {
      if (previous === 0) return current > 0 ? "+100%" : "0%";
      const change = ((current - previous) / previous) * 100;
      return `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`;
    };

    res.json({
      message: "Profit data calculated",
      timePeriod,
      comparisonLabel,
      metrics: {
        totalProfit,
        profitChange: getPercentageChange(totalProfit, prevTotalProfit),
        totalTransactionAmount,
        transactionAmountChange: getPercentageChange(
          totalTransactionAmount,
          prevTotalTransactionAmount
        ),
        totalAmountGB,
        amountGBChange: getPercentageChange(totalAmountGB, prevTotalAmountGB),
      },
      dateRanges: {
        current: {
          start: startDate.format("YYYY-MM-DD"),
          end: endDate.format("YYYY-MM-DD"),
        },
        comparison: {
          start: comparisonStartDate.format("YYYY-MM-DD"),
          end: comparisonEndDate.format("YYYY-MM-DD"),
        },
      },
    });
  } catch (error) {
    handleServerError(res, error, "An Error Occurred");
  }
};

//get subscription
export const getLatestSubscription = async (req: Request, res: Response) => {
  try {
    const userId = req.params.id;

    if (!userId) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const currentDate = new Date();
    const firstDayOfMonth = new Date(
      currentDate.getFullYear(),
      currentDate.getMonth(),
      1
    );
    const lastDayOfMonth = new Date(
      currentDate.getFullYear(),
      currentDate.getMonth() + 1,
      0
    );

    // Find the most recent subscription in the current month
    const currentSubscription = await Transaction.findOne({
      userId: new mongoose.Types.ObjectId(userId), // Ensure proper ObjectId matching
      currentSubscription: { $ne: null }, // Ensure currentSubscription is not null
      transactionStatus: "paid", // Only fetch paid transactions
      currentSubscriptionDate: {
        $gte: firstDayOfMonth,
        $lte: lastDayOfMonth,
      },
    })
      .sort({ currentSubscriptionDate: -1 }) // Sort by date in descending order
      .lean(); // Return a plain JavaScript object

    if (currentSubscription) {
      res.status(200).json({ subscription: currentSubscription });
      return;
    }

    // If no current month subscription, get the latest past subscription
    const latestSubscription = await Transaction.findOne({
      userId: new mongoose.Types.ObjectId(userId),
      currentSubscription: { $ne: null },
      transactionStatus: "paid", // Only fetch paid transactions
    })
      .sort({ currentSubscriptionDate: -1 }) // Get the most recent one
      .lean();

    if (latestSubscription) {
      res.json({ subscription: latestSubscription });
      return;
    }

    // No subscriptions found
    res.status(200).json({ error: "No subscription found for this user" });
    return;
  } catch (error) {
    handleServerError(res, error, "An Error Occurred");
  }
};

// Get all transactions
export const getTransactions = async (req: Request, res: Response) => {
  try {
    const { page = 1, limit = 50, userId, status, search } = req.query;

    const pageNumber = Number(page);
    const limitNumber = Number(limit);

    const filter: any = {};

    // Check if the user is an admin from the session or token
    const isAdmin = req?.user?.isAdmin; // Assuming `req.user` is populated by your authentication middleware

    // If isAdmin, ignore userId filtering
    if (!isAdmin) {
      if (userId) filter.userId = userId;
    }
    if (status) filter.transactionStatus = status;

    // Apply search filter for orderId or email
    if (search) {
      const searchRegex = new RegExp(search as string, "i"); // Make regex once

      // Try finding users matching the email
      const users = await User.find({ email: searchRegex }).select("_id");

      const userIds = users.map((user) => user._id);

      filter.$or = [{ orderId: searchRegex }, { userId: { $in: userIds } }];
    }
    const transactions = await Transaction.find(filter)
      .populate("userId", "email")
      .skip((pageNumber - 1) * limitNumber)
      .limit(limitNumber)
      .sort({ _id: -1 });

    const totalTransactions = await Transaction.countDocuments(filter);

    res.json({
      totalTransactions,
      page: pageNumber,
      totalPages: Math.ceil(totalTransactions / limitNumber),
      transactions,
    });
  } catch (error) {
    handleServerError(res, error, "Error fetching transactions");
  }
};

// Get transaction by ID
export const getTransaction = async (req: Request, res: Response) => {
  try {
    const transaction = await Transaction.findById(req.params.id).populate(
      "userId",
      "email"
    );

    if (!transaction) {
      res.status(404).json({ message: "Transaction not found" });
      return;
    }

    res.json(transaction);
  } catch (error) {
    handleServerError(res, error, "Error fetching transaction");
  }
};

// Create a deposit transaction //Obsolete
export const createTransaction = async (req: Request, res: Response) => {
  try {
    const { userId, amount, method, amountGB } = req.body;
    const product = "Residential";
    if (!userId || !amount || !method || amountGB === undefined) {
      res.status(400).json({ message: "All fields are required" });
      return;
    }

    // Validate method
    if (!["Cryptocurrency", "Mpesa"].includes(method)) {
      res.status(400).json({ message: "Invalid deposit method" });
      return;
    }

    const user = await User.findById(userId);
    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    // Generate unique 7-digit orderId starting with "SM"
    let orderId;
    let isUnique = false;

    while (!isUnique) {
      const randomDigits = Math.floor(
        100000 + Math.random() * 900000
      ).toString(); // 6 random digits
      orderId = `SM${randomDigits}`; // Ensure orderId starts with "SM"

      const existingTransaction = await Transaction.findOne({ orderId });
      if (!existingTransaction) {
        isUnique = true;
      }
    }

    const transaction = new Transaction({
      orderId, // Assign the generated orderId
      userId,
      transactionAmount: amount,
      method,
      amountGB,
      product,
    });

    await transaction.save();

    res.status(201).json({
      message: "Transaction created successfully",
      transaction,
    });
  } catch (error) {
    handleServerError(res, error, "Error creating transaction");
  }
};

// Update transaction status (Admin only)
export const updateTransactionStatus = async (req: Request, res: Response) => {
  try {
    const { status } = req.body;

    if (
      !["pending", "paid", "failed", "expired", "partial_paid"].includes(status)
    ) {
      res.status(400).json({ message: "Invalid transaction status" });
      return;
    }

    const transaction = await Transaction.findByIdAndUpdate(
      req.params.id,
      { $set: { transactionStatus: status } },
      { new: true, runValidators: true }
    );
    if (!transaction) {
      res.status(404).json({ message: "Transaction not found" });
      return;
    }

    res.json({ message: "Transaction status updated", transaction });
  } catch (error) {
    handleServerError(res, error, "Error updating transaction status");
  }
};

// Delete a transaction (if needed)
export const deleteTransaction = async (req: Request, res: Response) => {
  try {
    await Transaction.findByIdAndDelete(req.params.id);

    res.json({ message: "Transaction deleted successfully" });
  } catch (error) {
    handleServerError(res, error, "Error deleting transaction");
  }
};

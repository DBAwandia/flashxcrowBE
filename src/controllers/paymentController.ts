import { Request, Response } from "express";
import dotenv from "dotenv";
import User from "../model/userModel";
import Transaction from "../model/transactionModel";
import { gbToBytes } from "../utils/gigaBytesConvertor";
import {
  generateSignatureForCreate,
  generateSignatureForGet,
} from "../utils/generateSignature";
import { handleServerError } from "../utils/handleServerError";
import {
  getSubUsersService,
  updateSubUserService,
} from "../services/proxyService";
import {
  createInvoiceService,
  getPaymentStatusService,
} from "../services/paymentService";

import { createChargeService } from "../services/paystackMpesa";
import * as crypto from "crypto";
import { formatPhoneNumber } from "../utils/formartPhonenumber";
import { createKopoKopoChargeService } from "../services/kopokopoMpesa";
import Transfers from "../model/transfersModel";

dotenv.config();
const merchantNo = process.env.COINPAL_MERCHANT_ID as string;
const tillNumber = process.env.KOPO_KOPO_TILL_NUMBER as string;

const options = {
  clientId: process.env.K2_CLIENT_ID,
  clientSecret: process.env.K2_CLIENT_SECRET,
  baseUrl: process.env.K2_BASE_URL,
  apiKey: process.env.K2_API_KEY,
};

// PAYSTACK CHARGE
export const createPaystackCharge = async (req: Request, res: Response) => {
  try {
    const {
      priceAmount,
      priceCurrency,
      orderDescription,
      customerEmail,
      method,
      rate,
      phone,
      provider,
      amountGB, // Ensure this is also included
    } = req.body;
    const product = "Residential Proxy";

    // Validate required fields
    if (
      !priceAmount ||
      !priceCurrency ||
      !orderDescription ||
      !phone ||
      !provider ||
      !rate
    ) {
      res.status(400).json({ error: "Missing required fields" });
      return;
    }

    // Check if user exists
    const user = await User.findOne({ email: customerEmail });
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // ✅ Generate a unique orderId BEFORE making the API request
    let orderId: any;
    let isUnique = false;

    while (!isUnique) {
      const randomDigits = Math.floor(
        100000 + Math.random() * 900000
      ).toString();
      orderId = `SM${randomDigits}`;
      const existingTransaction = await Transaction.findOne({ orderId });
      if (!existingTransaction) isUnique = true;
    }

    const payStackamountFormat = priceAmount * 100;
    // Remove the leading 0 and add +254
    const formattedPhone = `+254${phone.substring(1)}`;

    const requestData = {
      amount: payStackamountFormat, //cents from paystack
      email: customerEmail,
      currency: priceCurrency,
      mobile_money: {
        phone: formattedPhone,
        provider: provider,
      },
    };

    // ✅ Make API request to create charge
    const response = await createChargeService(requestData);
    if (!response) {
      res.status(400).json({ error: "Failed to create invoice" });
      return;
    }

    // ✅ Extract Subscription Type & GB from orderDescription
    const subscriptionRegex =
      /(Growth|Starter|Pro|Elite|Premium|Enterprise)\s*\((\d+)GB\)/i;
    const match = orderDescription?.match(subscriptionRegex);
    let currentSubscription = ""; // Default value

    if (match) {
      const planName = match[1]; // e.g., "Growth"
      const gbAmount = match[2]; // e.g., "10"
      currentSubscription = `${planName} (${gbAmount}GB)`;
    }
    const formartamountToUsdt = priceAmount / rate;
    console.log(response);

    // ✅ Store transaction details in the database with PENDING status
    const transaction = new Transaction({
      orderId,
      userId: user?._id,
      transactionAmount: formartamountToUsdt, //In USD
      method,
      amountGB,
      payUrl: "",
      product,
      reference: response?.data?.reference,
      transactionStatus: "pending",
      currentSubscription, // Only updates if a valid match is found
      currentSubscriptionDate: new Date(),
    });

    await transaction.save();

    // ✅ Return invoice details to the client
    res
      .status(200)
      .json({ message: "Charge Invoice created successfully", response });
  } catch (error: any) {
    let countdown = 3;

    const updateMessage = () => {
      if (countdown > 1) {
        console.log(
          `${countdown}s... A network issue occurred. Please try again in `
        );
        countdown--;
        setTimeout(updateMessage, 1000);
      } else {
        handleServerError(
          res,
          error,
          "A network issue occurred. Please try again."
        );
      }
    };

    updateMessage(); // Start countdown
  }
};

// KOPOKOPO CHARGE
export const createKopokopoCharge = async (req: Request, res: Response) => {
  try {
    const {
      priceAmount,
      priceCurrency,
      orderDescription,
      customerEmail,
      method,
      rate,
      phone,
      provider,
      amountGB, // Ensure this is also included
    } = req.body;
    const product = "Residential Proxy";

    if (provider !== "mpesa") {
      res
        .status(403)
        .json({ message: "Oops! Payment method unavailable. Use Mpesa." });
      return;
    }
    // Validate required fields
    if (
      !priceAmount ||
      !priceCurrency ||
      !orderDescription ||
      !phone ||
      !provider ||
      !rate
    ) {
      res.status(400).json({ error: "Missing required fields" });
      return;
    }

    // Check if user exists
    const user = await User.findOne({ email: customerEmail });
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // ✅ Generate a unique orderId BEFORE making the API request
    let orderId: any;
    let isUnique = false;

    while (!isUnique) {
      const randomDigits = Math.floor(
        100000 + Math.random() * 900000
      ).toString();
      orderId = `SM${randomDigits}`;
      const existingTransaction = await Transaction.findOne({ orderId });
      if (!existingTransaction) isUnique = true;
    }

    const formattedPhone = formatPhoneNumber(phone?.trim());

    const requestData = {
      payment_channel: "M-PESA STK Push",
      till_number: tillNumber,
      orderId,
      amount: {
        currency: priceCurrency,
        value: Math.round(priceAmount),
      },
      subscriber: {
        phone: formattedPhone,
        email: customerEmail,
      },
      links: {
        callback_url:
          "https://backend.shadowmaxproxy.com/api/v1/payments/kopokopo/webhook",
      },
    };

    // ✅ Make API request to create charge
    const response = await createKopoKopoChargeService(requestData);
    if (response !== 201) {
      res.status(400).json({ error: "Failed to create invoice" });
      return;
    }

    // ✅ Extract Subscription Type & GB from orderDescription
    const subscriptionRegex =
      /(Growth|Starter|Pro|Elite|Premium|Enterprise)\s*\((\d+)GB\)/i;
    const match = orderDescription?.match(subscriptionRegex);
    let currentSubscription = ""; // Default value

    if (match) {
      const planName = match[1]; // e.g., "Growth"
      const gbAmount = match[2]; // e.g., "10"
      currentSubscription = `${planName} (${gbAmount}GB)`;
    }
    const formartamountToUsdt = priceAmount / rate;

    // ✅ Store transaction details in the database with PENDING status
    const transaction = new Transaction({
      orderId,
      userId: user?._id,
      transactionAmount: formartamountToUsdt?.toFixed(2), //In USD
      method,
      amountGB,
      payUrl: "",
      product,
      reference: "",
      transactionStatus: "pending",
      currentSubscription, // Only updates if a valid match is found
      currentSubscriptionDate: new Date(),
    });

    await transaction.save();

    // ✅ Return invoice details to the client
    res
      .status(200)
      .json({ message: "Charge Invoice created successfully", response });
  } catch (error: any) {
    let countdown = 3;

    const updateMessage = () => {
      if (countdown > 1) {
        console.log(
          `${countdown}s... A network issue occurred. Please try again in `
        );
        countdown--;
        setTimeout(updateMessage, 1000);
      } else {
        handleServerError(
          res,
          error,
          "A network issue occurred. Please try again."
        );
      }
    };

    updateMessage(); // Start countdown
  }
};

/**
 * Create an invoice using NowPayments API
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 */
export const createInvoice = async (req: Request, res: Response) => {
  try {
    const {
      priceAmount,
      priceCurrency,
      orderDescription,
      customerEmail,
      method,
      amountGB, // Ensure this is also included
    } = req.body;
    const product = "Residential Proxy";

    // Validate required fields
    if (!priceAmount || !priceCurrency || !orderDescription) {
      res.status(400).json({ error: "Missing required fields" });
      return;
    }

    // Check if user exists
    const user = await User.findOne({ email: customerEmail });
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // ✅ Generate a unique orderId BEFORE making the API request
    let orderId: any;
    let isUnique = false;

    while (!isUnique) {
      const randomDigits = Math.floor(
        100000 + Math.random() * 900000
      ).toString();
      orderId = `SM${randomDigits}`;
      const existingTransaction = await Transaction.findOne({ orderId });
      if (!existingTransaction) isUnique = true;
    }

    const requestId = `REQ-${Date.now()}`; // Unique request ID
    const secretKey = process.env.COIN_PAL_SECRET_KEY as string;

    // Generate signature
    const sign = generateSignatureForCreate(
      secretKey,
      requestId,
      merchantNo,
      orderId,
      priceAmount,
      priceCurrency
    );

    // Prepare request data
    const requestData = {
      version: "2.1",
      requestId,
      merchantNo: merchantNo,
      orderNo: orderId,
      orderCurrencyType: "crypto",
      merchantName: "ShadowmaxProxy.com",
      orderCurrency: priceCurrency,
      orderAmount: priceAmount,
      payerEmail: customerEmail,
      resultNotifyUser: true,
      notifyURL: "https://backend.shadowmaxproxy.com/api/v1/payments/webhook",
      redirectURL: "https://shadowmaxproxy.com/transfer",
      sign,
    };

    // ✅ Make API request to create invoice
    const response = await createInvoiceService(requestData);
    if (!response) {
      res.status(400).json({ error: "Failed to create invoice" });
      return;
    }

    // ✅ Extract Subscription Type & GB from orderDescription
    const subscriptionRegex =
      /(Growth|Starter|Pro|Elite|Premium|Enterprise)\s*\((\d+)GB\)/i;
    const match = orderDescription?.match(subscriptionRegex);
    let currentSubscription = ""; // Default value

    if (match) {
      const planName = match[1]; // e.g., "Growth"
      const gbAmount = match[2]; // e.g., "10"
      currentSubscription = `${planName} (${gbAmount}GB)`;
    }

    // ✅ Store transaction details in the database with PENDING status
    const transaction = new Transaction({
      orderId,
      userId: user?._id,
      transactionAmount: priceAmount,
      method,
      amountGB,
      payUrl: response.nextStepContent,
      product,
      reference: response?.reference,
      transactionStatus: "pending",
      currentSubscription, // Only updates if a valid match is found
      currentSubscriptionDate: new Date(),
    });

    await transaction.save();

    // ✅ Return invoice details to the client
    res.status(200).json({ message: "Invoice created successfully", response });
  } catch (error: any) {
    let countdown = 3;

    const updateMessage = () => {
      if (countdown > 1) {
        // console.log(
        //   `${countdown}s... A network issue occurred. Please try again in `
        // );
        countdown--;
        setTimeout(updateMessage, 1000);
      } else {
        handleServerError(
          res,
          error,
          "A network issue occurred. Please try again."
        );
      }
    };

    updateMessage(); // Start countdown
  }
};

// https://shadowmaxproxy.com/?version=2.1&requestId=REQ-1740723017666&merchantNo=100007249&orderNo=SM210005&reference=CWSRZ16Z6MP4MH4A&orderCurrency=USDT&orderAmouSnt=10&paidOrderAmount=11.00000000&paymentMethod=Crypto+Payment&selectedWallet=9999&dueCurrency=USDT&dueAmount=10.000000&network=BEP20&paidCurrency=USDT&paidAmount=11.000000&paidUsdt=11.000000&paidAddress=0x65c39Ce671560c02Eb4baECACe5149F39fb282fF&confirmedTime=1740723320&status=paid&remark=&unresolvedLabel=overpaid&sign=1059e9680f29331faeecc98e1b8b8e41b8cd36400fbf3b2e0566c899ad6d3dde
// WEBHOOK FOR COINPAL
export const paymentTracking = async (req: Request, res: Response) => {
  try {
    const notifyData = req.body;
    const {
      requestId,
      merchantNo,
      orderNo,
      reference,
      orderCurrency,
      paidCurrency,
      orderAmount,
      paidAmount,
      status,
      sign,
    } = notifyData;

    if (!merchantNo || !orderNo || !reference || !sign) {
      res
        .status(402)
        .json({ error: "Missing required fields in webhook data" });
      return;
    }

    // Verify signature
    const expectedSignature = generateSignatureForCreate(
      process.env.COIN_PAL_SECRET_KEY as string,
      requestId,
      merchantNo,
      orderNo,
      orderAmount,
      orderCurrency
    );

    if (sign !== expectedSignature) {
      res.status(403).json({ error: "Signature verification failed" });
      return;
    }

    // Normalize status
    let normalizedStatus = status;
    if (
      status === "paid_confirming" ||
      status === "paid" ||
      Math.abs(Number(orderAmount) - Number(paidAmount)) <= 0.5 ||
      Number(paidAmount) > Number(orderAmount) // Treat overpayments as paid
    ) {
      normalizedStatus = "paid";
    } else if (
      status === "partial_paid_confirming" ||
      status === "partial_paid"
    ) {
      normalizedStatus = "partial_paid";
    }

    // Handle partial payment response
    if (normalizedStatus === "partial_paid") {
      res.status(200).json({
        success: true,
        message: "Partial payment received",
        updatedStatus: normalizedStatus,
      });
      return;
    }

    // Find transaction
    const transaction = await Transaction.findOne({ orderId: orderNo });
    if (!transaction) {
      res.status(404).json({ error: "Transaction not found" });
      return;
    }

    if (transaction.transactionStatus === "paid") {
      res.status(403).json({ error: "Payment already processed" });
      return;
    }

    // Update transaction status if not already marked as paid
    const updatedTransaction = await Transaction.findOneAndUpdate(
      { orderId: orderNo, transactionStatus: { $ne: "paid" } },
      {
        currency: paidCurrency || orderCurrency,
        transactionStatus: normalizedStatus,
        transactionAmount: Number(orderAmount),
        paidAmount: Number(paidAmount),
      },
      { new: true }
    );

    if (!updatedTransaction) {
      res.status(400).json({ error: "Transaction update failed" });
      return;
    }

    // Process fully paid transaction
    if (normalizedStatus === "paid") {
      const { userId, amountGB } = updatedTransaction;
      if (!userId || !amountGB) {
        res
          .status(400)
          .json({ error: "User ID or amountGB missing in transaction" });
        return;
      }

      const user = await User.findById(userId);
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      const subUserId = user.subUserId as string;
      const subUserResponse = await getSubUsersService(subUserId);
      const currentTrafficLimit = subUserResponse?.payload?.traffic_limit || 0;
      let usedBalance = subUserResponse?.payload?.used_traffic || 0;

      // If available balance is zero or negative, reset usedBalance to 0
      const availableBalance = currentTrafficLimit - Math.max(0, usedBalance);
      if (availableBalance <= 0) {
        usedBalance = 0;
      }

      const newTrafficLimit = availableBalance + gbToBytes(amountGB);

      const updateResult = await updateSubUserService(subUserId, {
        used_traffic: 0,
        traffic_limit: newTrafficLimit,
      });

      if (
        !updateResult?.success ||
        Object.keys(updateResult?.errors || {}).length > 0
      ) {
        console.error(
          "❌ Failed to update traffic limit:",
          updateResult?.errors
        );
        res
          .status(500)
          .json({ message: "Failed to update sub-user traffic limit" });
        return;
      }

      await User.findByIdAndUpdate(
        userId,
        {
          $inc: { paymentCount: 1 },
          $set: {
            balance: amountGB,
            lastTransactionDate: new Date(),
            lastAmountGB: amountGB,
          },
        },
        { new: true }
      );

      await Transfers.create({
        fromEmail: "Shadowmax Recharge", // System is the sender
        toEmail: user.email,
        amount: amountGB,
        reverse: false,
        type: "System Credit",
        timestamp: new Date(),
      });
    }

    res
      .status(200)
      .json({ success: true, message: "Webhook processed successfully" });
    return;
  } catch (error) {
    handleServerError(res, error, "Internal Server Error");
  }
};

//WEBHOOK FOR PAYSTACK MPESA
export const paymentMobileTracking = async (req: Request, res: Response) => {
  try {
    const secret = process.env.PAY_STACK_SECRET_KEY;
    const hash = crypto
      .createHmac("sha512", secret!)
      .update(JSON.stringify(req.body))
      .digest("hex");

    if (hash !== req.headers["x-paystack-signature"]) {
      // console.log("Unauthorized webhook request");
      res.status(401).json({ error: "Unauthorized request" });
      return;
    }

    const event = req.body;
    // console.log("Received Paystack event:", event);
    const { reference, amount, currency } = event.data;

    // 🟥 Handle charge.failed (mark transaction as failed)
    if (event.event === "charge.failed") {
      await Transaction.findOneAndUpdate(
        { reference },
        { transactionStatus: "failed" },
        { new: true }
      );

      // console.log(`❌ Payment failed for transaction: ${reference}`);
      res.status(200).json({ message: "Transaction marked as failed" });
      return;
    }

    if (event.event !== "charge.success") {
      // console.log("Unhandled Paystack event:", event.event);
      res.sendStatus(200);
      return;
    }

    // 🔍 Find transaction using reference
    const transaction = await Transaction.findOne({ reference });
    if (!transaction) {
      res.status(404).json({ error: "Transaction not found" });
      return;
    }

    if (transaction.transactionStatus === "paid") {
      res.status(403).json({ error: "Payment already processed" });
      return;
    }

    const { transactionAmount, orderId, userId, amountGB } = transaction; // Extract orderId and userId from Transaction
    const paidAmount =
      typeof amount === "number" && !isNaN(amount) ? amount / 100 / 132 : 0;
    // Convert from kobo to standard currency
    const mpesaPaidAmount = paidAmount * 132; //Update mpesa conversion to db
    // Determine transaction status based on the amount paid
    let transactionStatus = "paid";

    if (paidAmount < transactionAmount - 0.3) {
      transactionStatus = "partial_paid";
    }

    if (paidAmount === 0 || isNaN(paidAmount)) {
      transactionStatus = "failed";
    }

    // 🛠 Update transaction record
    const updatedTransaction = await Transaction.findOneAndUpdate(
      { reference, transactionStatus: { $ne: "paid" } },
      {
        currency,
        transactionStatus: "paid",
        amount: Number(paidAmount),
        paidAmount: Number(mpesaPaidAmount),
      },
      { new: true }
    );

    if (!updatedTransaction) {
      res.status(400).json({ error: "Transaction update failed" });
      return;
    }

    // 🚨 If the transaction is "partially paid", return immediately
    if (transactionStatus === "partial_paid") {
      res
        .status(200)
        .json({ message: "Transaction updated as partially paid" });
      return;
    }

    // 🏦 Update User Balance and SubUser Traffic Limit
    if (userId) {
      const user = await User.findById(userId);
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      const subUserId = user.subUserId as string;
      const subUserResponse = await getSubUsersService(subUserId);
      const currentTrafficLimit = subUserResponse?.payload?.traffic_limit || 0;
      let usedBalance = subUserResponse?.payload?.used_traffic || 0;

      // If available balance is zero or negative, reset usedBalance
      const availableBalance = currentTrafficLimit - Math.max(0, usedBalance);
      if (availableBalance <= 0) {
        usedBalance = 0;
      }

      const newTrafficLimit = availableBalance + gbToBytes(amountGB);

      await updateSubUserService(subUserId, {
        used_traffic: 0,
        traffic_limit: newTrafficLimit,
      });

      await User.findByIdAndUpdate(
        userId,
        {
          $inc: { paymentCount: 1 },
          $set: {
            balance: amountGB,
            lastTransactionDate: new Date(),
            lastAmountGB: amountGB,
          },
        },
        { new: true }
      );
    }

    console.log("✅ Payment successfully processed for order:", orderId);
    res.sendStatus(200);
  } catch (error) {
    handleServerError(res, error, "Internal Server Error");
  }
};

//WEBHOOK KOPOKOPO MPESA
// Webhook handler
export const paymentKopokopoTracking = async (req: Request, res: Response) => {
  try {
    const apiKey = process.env.K2_API_KEY;
    const signature = req.headers["x-kopokopo-signature"] as string;

    if (!signature) {
      res.status(401).json({ error: "Missing X-KopoKopo-Signature header" });
      return;
    }

    const hash = crypto
      .createHmac("sha256", apiKey as string)
      .update(JSON.stringify(req.body))
      .digest("hex");

    if (hash !== signature) {
      res.status(401).json({ error: "Unauthorized request" });
      return;
    }

    const event = req.body?.data?.attributes?.event; //currency, amount, status,
    const metadata = req.body?.data?.attributes?.metadata; //orderId

    const resource = event?.resource;

    if (!resource) {
      res.status(400).json({ error: "Invalid webhook payload" });
      return;
    }

    const { status, amount: paidAmount, currency } = resource;

    const orderId = metadata?.reference;

    if (!orderId) {
      res.status(400).json({ error: "Order ID (reference) not found" });
      return;
    }

    if (status !== "Received") {
      await Transaction.findOneAndUpdate(
        { orderId },
        { $set: { transactionStatus: "failed" } },
        { new: true }
      );
      res.status(400).json({ error: "Payment status is not Success" });
      return;
    }

    // 🛠 Retrieve the transaction
    const transaction = await Transaction.findOne({ orderId });
    if (!transaction) {
      res.status(404).json({ error: "Transaction not found" });
      return;
    }

    const { transactionAmount, userId, amountGB } = transaction;

    // Determine transaction status based on amount paid
    let transactionStatus = "paid";
    if (paidAmount < transactionAmount - 0.3) {
      transactionStatus = "partial_paid";
    }

    // 🛠 Update transaction with payment details
    const updatedTransaction = await Transaction.findOneAndUpdate(
      { orderId, transactionStatus: { $ne: "paid" } },
      {
        $set: {
          transactionStatus,
          currency,
          amount: transactionAmount,
          paidAmount: paidAmount,
        },
      },
      { new: true }
    );

    if (!updatedTransaction) {
      res.status(400).json({ error: "Transaction update failed" });
      return;
    }

    // If the transaction is "partially paid", return immediately
    if (transactionStatus === "partial_paid") {
      res
        .status(200)
        .json({ message: "Transaction updated as partially paid" });
      return;
    }

    // ✅ Update User Balance and SubUser Traffic Limit
    if (userId) {
      const user = await User.findById(userId);
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      const subUserId = user.subUserId as string;
      const subUserResponse = await getSubUsersService(subUserId);

      const currentTrafficLimit = subUserResponse?.payload?.traffic_limit || 0;
      let usedBalance = subUserResponse?.payload?.used_traffic || 0;

      // Ensure used balance is not negative
      const availableBalance = Math.max(0, currentTrafficLimit - usedBalance);

      // Convert GB to Bytes
      const additionalTraffic = gbToBytes(amountGB);
      console.log("🔹 Additional Traffic (Bytes):", additionalTraffic);

      const newTrafficLimit = availableBalance + additionalTraffic;
      console.log("🔹 New Traffic Limit (Bytes):", newTrafficLimit);

      // ✅ Update SubUser Traffic
      const updateResult = await updateSubUserService(subUserId, {
        used_traffic: 0, // Reset used traffic
        traffic_limit: newTrafficLimit,
      });

      if (
        !updateResult?.success ||
        Object.keys(updateResult?.errors || {}).length > 0
      ) {
        console.error(
          "❌ Failed to update traffic limit:",
          updateResult?.errors
        );
        res.status(500).json({ message: "Failed to update sub-user traffic" });
        return;
      }

      // ✅ Update User Balance
      await User.findByIdAndUpdate(
        userId,
        {
          $inc: { paymentCount: 1 },
          $set: {
            balance: amountGB,
            lastTransactionDate: new Date(),
            lastAmountGB: amountGB,
          },
        },
        { new: true }
      );

      await Transfers.create({
        fromEmail: "Shadowmax Recharge", // System is the sender
        toEmail: user.email,
        amount: amountGB,
        reverse: false,
        type: "System Credit",
        timestamp: new Date(),
      });
    }

    console.log("✅ Payment successfully processed for order:", orderId);
    res.status(200).json({ message: "Payment processed successfully" });
    return;
  } catch (error) {
    console.error("❌ Error processing webhook:", error);
    if (!res.headersSent) {
      res.status(500).send("Error processing webhook");
      return;
    }
  }
};

// Function to handle reversed payments
// const handleReversedPayment = async (orderId: string, res: Response) => {
//   try {
//     await Transaction.findOneAndUpdate(
//       { orderId },
//       { transactionStatus: "reversed" },
//       { new: true }
//     );

//     console.log(`❌ Payment reversed for transaction: ${orderId}`);
//     res.status(200).json({ message: "Transaction marked as reversed" });
//   } catch (error) {
//     console.error("Error handling reversed payment:", error);
//     res.status(500).send("Error handling reversed payment");
//   }
// };
/**
 * Create an invoice using NowPayments API
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 */

export const getTransactionStatus = async (req: Request, res: Response) => {
  const { orderId } = req.body;
  const timestamp = Math.floor(Date.now() / 1000).toString();

  try {
    // ✅ Find the transaction in the database
    const transaction = await Transaction.findOne({ orderId });
    if (!transaction) {
      res.status(404).json({ error: "Transaction not found" });
      return;
    }

    const { reference, transactionAmount } = transaction;

    // ✅ Generate signature
    const sign = generateSignatureForGet(
      process.env.COIN_PAL_SECRET_KEY as string,
      reference as string,
      merchantNo,
      timestamp
    );

    // ✅ Prepare request data
    const data = {
      version: "2.1",
      reference,
      merchantNo,
      timestamp,
      sign,
    };

    // ✅ Fetch transaction status from payment service
    const response = await getPaymentStatusService(data);

    const status = response?.status;
    const paidOrderAmount = response?.paidOrderAmount;

    if (!status) {
      res.status(404).json({ error: "Transaction not found" });
      return;
    }
    // ✅ Normalize the status value
    let normalizedStatus: string = status.toLowerCase();

    // ✅ If status is unpaid, set it as pending
    if (normalizedStatus === "unpaid") {
      normalizedStatus = "pending";
    }

    // ✅ Handle null or undefined paidOrderAmount
    const paidAmount = paidOrderAmount ?? 0; // Default to 0 if null or undefined

    // ✅ Adjust status to "paid" if the paid amount is close enough to the order amount
    const amountDifference = Math.abs(transactionAmount - paidAmount);
    if (
      normalizedStatus !== "paid" &&
      !isNaN(amountDifference) &&
      amountDifference <= 0.5
    ) {
      normalizedStatus = "paid";
    }

    // ✅ Update the transaction in the database
    const updatedTransaction = await Transaction.findOneAndUpdate(
      { orderId },
      {
        status: normalizedStatus,
        paidAmount: paidOrderAmount,
      },
      { new: true }
    );

    if (!updatedTransaction) {
      res.status(404).json({ error: "Transaction update failed" });
      return;
    }

    // ✅ Handle partial payments
    if (normalizedStatus === "partial_paid") {
      res.status(200).json({
        success: true,
        message: "Partial payment received",
        updatedStatus: normalizedStatus,
      });
      return;
    }

    // ✅ Handle partial payments
    if (normalizedStatus === "failed") {
      res.status(200).json({
        success: true,
        message: "Failed!",
        updatedStatus: normalizedStatus,
      });
      return;
    }

    // ✅ If payment is completed, update the user’s traffic limit
    if (normalizedStatus === "paid") {
      const { userId, amountGB } = updatedTransaction;

      if (!userId || !amountGB) {
        res
          .status(400)
          .json({ error: "User ID or amountGB missing in transaction" });
        return;
      }

      // ✅ Find the user
      const user = await User.findById(userId);
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      const subUserId = user.subUserId;

      // ✅ Fetch the sub-user's current traffic limit
      const subUserResponse = await getSubUsersService(subUserId);
      const currentTrafficLimit = subUserResponse?.payload?.traffic_limit || 0;

      // ✅ Convert amountGB to bytes and update the traffic limit
      const additionalTraffic = gbToBytes(amountGB);
      const newTrafficLimit = currentTrafficLimit + additionalTraffic;

      // ✅ Update the sub-user's traffic limit
      await updateSubUserService(subUserId as string, {
        traffic_limit: newTrafficLimit,
      });

      // ✅ Update user balance
      await User.findByIdAndUpdate(
        userId,
        { $set: { balance: amountGB } },
        { new: true, runValidators: true }
      );

      // ✅ Response with detailed status from the payment service
      res.status(200).json({
        success: true,
        message: "Transaction status updated",
        updatedStatus: normalizedStatus,
        rawStatus: status, // Returning the raw status from the payment service
        paidAmount: paidOrderAmount,
      });
      return;
    }

    // ✅ Default response if status is not handled
    res.status(200).json({ success: true, updatedStatus: normalizedStatus });
    return;
  } catch (error: any) {
    console.error(
      "Error fetching transaction status:",
      error.response?.data || error.message
    );

    res.status(error.response?.status || 500).json({
      error: "Failed to fetch transaction status",
      details: error.response?.data || error.message,
    });
    return;
  }
};

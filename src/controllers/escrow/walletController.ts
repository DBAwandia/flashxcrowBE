// controllers/walletController.ts
import { Request, Response } from "express";
import { AuthenticatedRequest } from "../../authenticate-middleware/middleware";
import { WalletTransaction } from "../../model/escrow/walletModel";
import { handleServerError } from "../../utils/handleServerError";
import { generateUniqueOrderId } from "../../utils/generateOrderId";
import User from "../../model/userModel";
import mongoose from "mongoose";
import { nowPaymentsService } from "../../services/nowpayments/nowPayments";
import { verifyNowPaymentsSignature } from "../../utils/nowpayments/verifyNowPaymentsSignature";
import { formatPhoneNumber } from "../../utils/formartPhonenumber";
import { createKopoKopoChargeService } from "../../services/kopokopoMpesa";
import * as crypto from "crypto";

export const getWalletTransactions = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const { page = 1, limit = 50, userEmail, status, search } = req.query;

    const pageNumber = Number(page);
    const limitNumber = Number(limit);

    const filter: any = {};
    const isAdmin = req?.user?.isAdmin;

    // Restrict to own transactions if not admin
    if (!isAdmin && req.user?.email) {
      filter.userEmail = req.user.email;
    } else if (userEmail) {
      filter.userEmail = userEmail;
    }

    if (status) filter.status = status;

    // Search by description, counterparty, or bonus name
    if (search) {
      const searchRegex = new RegExp(search as string, "i");
      filter.$or = [
        { description: searchRegex },
        { counterparty: searchRegex },
        { "bonus.name": searchRegex },
      ];
    }

    const transactions = await WalletTransaction.find(filter)
      .skip((pageNumber - 1) * limitNumber)
      .limit(limitNumber)
      .sort({ date: -1 });

    const totalTransactions = await WalletTransaction.countDocuments(filter);

    res.json({
      totalTransactions,
      page: pageNumber,
      totalPages: Math.ceil(totalTransactions / limitNumber),
      transactions,
    });
  } catch (error) {
    handleServerError(res, error, "Error fetching wallet transactions");
  }
};

export const createDeposit = async (req: Request, res: Response) => {
  try {
    const {
      amount,
      currency,
      method,
      network,
      customerEmail,
      title,
      phone,
      rate,
    } = req.body;
    console.log(customerEmail, "customerEmail");

    // ✅ Validate user
    const user = await User.findOne({ email: customerEmail });
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // ✅ Validate essential fields
    if (!amount || !currency || !method) {
      res.status(400).json({
        message: "Amount, currency, and method are required",
      });
      return;
    }

    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      res.status(400).json({ message: "Invalid amount" });
      return;
    }

    // ✅ Generate unique order ID
    const orderId = await generateUniqueOrderId(WalletTransaction, "XS", 8);

    // ✅ Base transaction structure
    let transactionData: any = {
      userEmail: customerEmail,
      type: "deposit",
      method,
      amount: amountNum,
      currency: currency.toUpperCase(),
      orderId,
      description: `${method} deposit - ${currency}`,
      fee: 0,
      status: "pending",
      date: new Date(),
    };

    // --- Handle M-Pesa Deposits (Kopokopo) ---
    if (method === "mpesa") {
      // ✅ Validate M-Pesa specific fields
      if (!phone) {
        res
          .status(400)
          .json({ error: "Phone number is required for M-Pesa deposits" });
        return;
      }

      if (!rate) {
        res
          .status(400)
          .json({ error: "Exchange rate is required for M-Pesa deposits" });
        return;
      }
      const formattedPhone = formatPhoneNumber(phone?.trim());

      // ✅ Prepare Kopokopo request data (same as your existing implementation)
      const requestData = {
        payment_channel: "M-PESA STK Push",
        till_number: process.env.KOPO_KOPO_TILL_NUMBER as string, // Your Kopokopo till number
        orderId,
        amount: {
          currency: currency,
          value: Math.round(amountNum),
        },
        subscriber: {
          phone: formattedPhone,
          email: customerEmail,
        },
        links: {
          callback_url:
            process.env.KOPOKOPO_WEBHOOK_URL ||
            "https://backend.shadowmaxproxy.com/api/v1/payments/kopokopo/webhook",
        },
      };

      console.log(
        "📤 Creating Kopokopo M-Pesa deposit:",
        JSON.stringify(requestData, null, 2)
      );

      // ✅ Make API request to create charge (using your existing service)
      const response = await createKopoKopoChargeService(requestData);
      if (response !== 201) {
        res
          .status(400)
          .json({ error: "Failed to create M-Pesa deposit request" });
        return;
      }

      // ✅ Convert amount to USD equivalent using rate
      const amountInUSD = amountNum / rate;

      // ✅ Store M-Pesa transaction data
      transactionData.orderId = orderId;
      transactionData.mpesaData = {
        phoneNumber: formattedPhone,
        orderId,
        processed: false,
        transactionId: null,
        tillNumber: process.env.KOPOKOPO_TILL_NUMBER,
        initiatedAt: new Date(),
        amountInUSD: amountInUSD,
        exchangeRate: rate,
      };

      transactionData.description = `M-Pesa deposit from ${formattedPhone}`;
      transactionData.counterparty = formattedPhone;
      transactionData.amount = amountInUSD; // Store in USD equivalent
      transactionData.currency = "USD"; // Convert to USD for wallet

      console.log(
        `✅ M-Pesa deposit initiated for user: ${customerEmail}, amount: ${amountNum} ${currency}`
      );

      const transaction = await WalletTransaction.create(transactionData);

      res.status(201).json({
        success: true,
        message:
          "M-Pesa deposit initiated successfully. Please check your phone for STK push.",
        transaction: {
          id: transaction._id,
          orderId: transaction.orderId,
          amount: transaction.amount,
          currency: transaction.currency,
          status: transaction.status,
        },
        mpesaData: {
          phoneNumber: formattedPhone,
          amount: amountNum,
          currency: currency,
        },
        instructions:
          "Check your phone for M-Pesa STK push prompt to complete the deposit.",
      });
      return;

      // --- Handle NOW Payments Crypto Deposits ---
    } else if (method === "cryptocurrency") {
      if (!network) {
        res.status(400).json({
          message: "Network is required for cryptocurrency deposits",
        });
        return;
      }

      // ✅ Extract and clean environment variables
      const rawIpnUrl = process.env.NOW_PAYMENTS_IPN_URL;
      const rawSuccessUrl = process.env.NOW_PAYMENTS_SUCCESS_URL;
      const rawCancelUrl = process.env.NOW_PAYMENTS_CANCEL_URL;

      // ✅ Clean the URLs - remove any quotes, spaces, or special characters
      const cleanUrl = (url: string | undefined): string | null => {
        if (!url) return null;

        // Remove all quotes and trim whitespace
        let cleaned = url.replace(/['"`]/g, "").trim();

        // Remove any trailing commas
        cleaned = cleaned.replace(/,$/, "");

        // Validate it's a proper URL
        try {
          new URL(cleaned);
          return cleaned;
        } catch (error) {
          console.error(`❌ Invalid URL after cleaning: ${cleaned}`);
          return null;
        }
      };

      const ipnCallbackUrl = cleanUrl(rawIpnUrl);
      const successUrl = cleanUrl(rawSuccessUrl);
      const cancelUrl = cleanUrl(rawCancelUrl);

      if (!ipnCallbackUrl) {
        res.status(500).json({
          message: "Payment service configuration error",
          details: "IPN callback URL is invalid or missing",
        });
        return;
      }

      // ✅ Build NOW Payments payload
      const payload: any = {
        price_amount: amountNum,
        price_currency: currency.toLowerCase(),
        ipn_callback_url: ipnCallbackUrl,
        order_id: orderId,
        pay_currency: network.toLowerCase(),
        order_description: title || "Wallet Deposit",
        is_fixed_rate: true,
        is_fee_paid_by_user: true,
      };

      // Add optional URLs only if they are valid
      if (successUrl) {
        payload.success_url = successUrl;
      }
      if (cancelUrl) {
        payload.cancel_url = cancelUrl;
      }
      if (customerEmail) {
        payload.customer_email = customerEmail;
      }

      console.log(
        "📤 Creating NOW Payments deposit:",
        JSON.stringify(payload, null, 2)
      );

      // ✅ Create NOW Payments invoice
      const paymentResponse = await nowPaymentsService.createInvoice(payload);

      // ✅ Validate NOW Payments response
      if (!paymentResponse || typeof paymentResponse !== "object") {
        console.error("❌ NOW Payments invalid response:", paymentResponse);
        res.status(400).json({
          message: "Invalid response from payment provider",
          details: paymentResponse,
        });
        return;
      }

      // Check for error in response
      if (paymentResponse.code || paymentResponse.message) {
        console.error("❌ NOW Payments API error:", paymentResponse);
        res.status(400).json({
          message: "Failed to create NOW Payments invoice",
          details: paymentResponse,
        });
        return;
      }

      // Check for required success fields
      if (!paymentResponse.id || !paymentResponse.invoice_url) {
        res.status(400).json({
          message: "An error occurred please try again",
          details: paymentResponse,
        });
        return;
      }

      // ✅ Store transaction
      transactionData.nowPaymentsData = {
        orderId,
        paymentId: paymentResponse.id,
        invoiceUrl: paymentResponse.invoice_url,
        paymentStatus: paymentResponse.payment_status || "pending",
        payAddress: null,
        payAmount: null,
        payCurrency: paymentResponse?.pay_currency,
        priceAmount: paymentResponse.price_amount,
        priceCurrency: paymentResponse.price_currency,
        createdAt: new Date(),
      };

      transactionData.description = `NOW Payments ${currency} deposit - Choose payment method`;

      const transaction = await WalletTransaction.create(transactionData);

      // ✅ Dynamic instructions based on network
      const networkLabel =
        network.toLowerCase() === "usdtbsc"
          ? "USDT (BEP20 - Binance Smart Chain)"
          : "USDT (TRC20 - Tron Network)";

      res.status(201).json({
        success: true,
        message:
          "Payment created successfully - Please choose your payment method",
        paymentUrl: paymentResponse.invoice_url,
        paymentId: paymentResponse.id,
        transaction: {
          id: transaction._id,
          orderId: transaction.orderId,
          amount: transaction.amount,
          currency: transaction.currency,
          status: transaction.status,
        },
        nowPaymentsData: {
          id: paymentResponse.id,
          paymentStatus: paymentResponse.payment_status,
          invoiceUrl: paymentResponse.invoice_url,
        },
        instructions: `Send your deposit using ${networkLabel}. Once paid, the transaction will automatically update on your dashboard.`,
      });
      return;
    }

    res.status(400).json({ message: "Unsupported payment method" });
    return;
  } catch (error: any) {
    console.error("Deposit creation error:", error);

    // Provide more specific error messages
    if (error.response?.data) {
      console.error("API error:", error.response.data);
      res.status(400).json({
        message: "Deposit creation failed",
        details: error.response.data,
      });
      return;
    }

    if (!res.headersSent) {
      handleServerError(res, error, "Error creating deposit");
    }
  }
};

// Enhanced webhook handler to handle both deposits and payouts
export const handleNowPaymentsWebhook = async (req: Request, res: Response) => {
  try {
    console.log("📥 Incoming NOW Payments IPN...");

    // ✅ Get the raw body for signature verification
    const rawBody = JSON.stringify(req.body);
    const signature = req.headers["x-nowpayments-sig"] as string;

    if (!signature) {
      console.error("❌ Missing X-NowPayments-Sig header");
      res
        .status(400)
        .json({ success: false, message: "Missing signature header" });
      return;
    }

    // ✅ Verify IPN signature using your preferred method
    const nowPaymentsSecret = process.env.NOW_PAYMENTS_IPN_SECRET;
    if (!nowPaymentsSecret) {
      console.error("❌ NOW_PAYMENTS_IPN_SECRET not configured");
      res
        .status(500)
        .json({ success: false, message: "Server misconfiguration" });
      return;
    }

    // Try sorted verification first (like your paymentTracking)
    const isValid = verifyNowPaymentsSignature(
      rawBody,
      signature,
      nowPaymentsSecret
    );

    if (!isValid) {
      console.error("❌ Invalid IPN signature — possible spoof attempt");
      res.status(401).json({ success: false, message: "Invalid signature" });
      return;
    }

    console.log("✅ IPN signature verified successfully");

    const ipnData = req.body;
    console.log("📋 IPN Data received:", JSON.stringify(ipnData, null, 2));

    // ✅ Check if this is a payout IPN or deposit IPN
    const isPayout = ipnData.payout_id || ipnData.withdrawal_id;

    if (isPayout) {
      await handlePayoutWebhook(ipnData, res);
    } else {
      await handleDepositWebhook(ipnData, res);
    }
  } catch (error) {
    console.error("❌ IPN processing error:", error);
    res.status(500).json({
      success: false,
      message: "IPN processing failed",
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return;
  }
};

// Handle payout-specific webhooks
async function handlePayoutWebhook(ipnData: any, res: Response) {
  const {
    payout_id,
    withdrawal_id,
    status,
    address,
    currency,
    amount,
    extra_id,
    payout_description,
    unique_external_id,
    error,
  } = ipnData;

  console.log(`🔄 Processing payout IPN: ${payout_id} (status: ${status})`);

  // ✅ Find transaction by unique_external_id (our orderId)
  const orderId = unique_external_id || withdrawal_id;
  const transaction = await WalletTransaction.findOne({ orderId });

  if (!transaction) {
    console.error(`❌ Payout transaction not found for order: ${orderId}`);
    res
      .status(404)
      .json({ success: false, message: "Payout transaction not found" });
    return;
  }

  // ✅ Prevent double processing for completed/failed transactions
  if (["completed", "failed"].includes(transaction.status)) {
    console.warn(
      `⚠️ Payout transaction ${orderId} already ${transaction.status} — skipping.`
    );
    res.status(200).json({
      success: true,
      message: `Payout already ${transaction.status}`,
      transactionId: transaction._id,
    });
    return;
  }

  // ✅ Prepare update data
  const updateData: Record<string, any> = {
    "nowPaymentsWithdrawalData.payoutId": payout_id,
    "nowPaymentsWithdrawalData.payoutStatus": status,
    "nowPaymentsWithdrawalData.lastIpnUpdate": new Date(),
  };

  // ✅ Update additional payout fields if available
  if (address) updateData["nowPaymentsWithdrawalData.address"] = address;
  if (currency) updateData["nowPaymentsWithdrawalData.currency"] = currency;
  if (amount)
    updateData["nowPaymentsWithdrawalData.amount"] = parseFloat(amount);
  if (extra_id) updateData["nowPaymentsWithdrawalData.extraId"] = extra_id;
  if (payout_description)
    updateData["nowPaymentsWithdrawalData.payoutDescription"] =
      payout_description;
  if (error) updateData["nowPaymentsWithdrawalData.error"] = error;

  // ✅ Map payout status to transaction status
  const statusMap: { [key: string]: string } = {
    creating: "pending",
    waiting: "pending",
    processing: "processing",
    sending: "processing",
    finished: "completed",
    failed: "failed",
    rejected: "failed",
  };

  const newStatus = statusMap[status] || "pending";
  updateData.status = newStatus;

  // ✅ Update transaction description with final status
  if (newStatus === "completed") {
    updateData.description = `Withdrawal completed to ${address} (${currency?.toUpperCase()})`;
  } else if (newStatus === "failed") {
    updateData.description = `Withdrawal failed to ${address} (${currency?.toUpperCase()})`;
    if (error) {
      updateData.description += ` - ${error}`;
    }
  }

  // ✅ If payout failed, refund user balance
  if (
    newStatus === "failed" &&
    transaction.userEmail &&
    !transaction.nowPaymentsWithdrawalData?.refunded
  ) {
    try {
      await User.findOneAndUpdate(
        { email: transaction.userEmail },
        { $inc: { walletBalance: transaction.amount } }
      );
      updateData["nowPaymentsWithdrawalData.refunded"] = true;
      updateData["nowPaymentsWithdrawalData.refundedAt"] = new Date();
      console.log(
        `💰 Refunded ${transaction.amount} to ${transaction.userEmail} due to payout failure`
      );
    } catch (refundError) {
      console.error("Error refunding user balance:", refundError);
    }
  }

  // ✅ Update transaction
  const updatedTransaction = await WalletTransaction.findByIdAndUpdate(
    { _id: transaction._id, status: { $ne: "completed" } },
    { $set: updateData },
    { new: true, runValidators: true }
  );

  if (!updatedTransaction) {
    throw new Error("Payout transaction update failed");
  }

  console.log(`✅ Payout transaction updated (status: ${newStatus})`);

  res.status(200).json({
    success: true,
    message: "Payout IPN processed successfully",
    status: newStatus,
    transactionId: updatedTransaction._id,
  });
}

// Handle deposit-specific webhooks
async function handleDepositWebhook(ipnData: any, res: Response) {
  const {
    payment_id,
    order_id,
    payment_status,
    pay_amount,
    pay_currency,
    pay_address,
    price_amount,
    price_currency,
    actually_paid,
    outcome_amount,
    outcome_currency,
    purchase_id,
    created_at,
    updated_at,
  } = ipnData;

  console.log(
    `🔄 Processing deposit IPN for order ${order_id} (status: ${payment_status})`
  );

  // ✅ Basic validation
  if (!order_id || !payment_status) {
    res
      .status(400)
      .json({ success: false, message: "Missing required fields" });
    return;
  }

  // ✅ Find transaction
  const transaction = await WalletTransaction.findOne({ orderId: order_id });
  if (!transaction) {
    console.error(`❌ Deposit transaction not found for order: ${order_id}`);
    res.status(404).json({ success: false, message: "Transaction not found" });
    return;
  }

  // ✅ Prevent double processing for completed transactions
  if (transaction.status === "completed" && transaction.walletCredited) {
    console.warn(
      `⚠️ Transaction ${order_id} already completed and credited — skipping.`
    );
    res.status(200).json({
      success: true,
      message: "Transaction already completed",
      transactionId: transaction._id,
    });
    return;
  }

  // ✅ Prepare update data
  const updateData: Record<string, any> = {
    "nowPaymentsData.paymentId": payment_id,
    "nowPaymentsData.paymentStatus": payment_status,
    "nowPaymentsData.lastIpnUpdate": new Date(),
  };

  // ✅ Update payment method details
  if (pay_amount !== undefined)
    updateData["nowPaymentsData.payAmount"] = parseFloat(pay_amount);
  if (pay_currency) updateData["nowPaymentsData.payCurrency"] = pay_currency;
  if (pay_address) updateData["nowPaymentsData.payAddress"] = pay_address;
  if (price_amount !== undefined)
    updateData["nowPaymentsData.priceAmount"] = parseFloat(price_amount);
  if (price_currency)
    updateData["nowPaymentsData.priceCurrency"] = price_currency;

  // ✅ Additional IPN fields
  if (actually_paid !== undefined)
    updateData["nowPaymentsData.actually_paid"] = parseFloat(actually_paid);
  if (outcome_amount !== undefined)
    updateData["nowPaymentsData.outcome_amount"] = parseFloat(outcome_amount);
  if (outcome_currency)
    updateData["nowPaymentsData.outcome_currency"] = outcome_currency;
  if (purchase_id) updateData["nowPaymentsData.purchase_id"] = purchase_id;

  if (created_at)
    updateData["nowPaymentsData.createdAt"] = new Date(created_at);
  if (updated_at)
    updateData["nowPaymentsData.updatedAt"] = new Date(updated_at);

  // ✅ Map NOW Payments status to local transaction status
  const statusMap: Record<string, string> = {
    waiting: "pending",
    confirming: "processing",
    confirmed: "completed",
    sending: "processing",
    partially_paid: "partial",
    finished: "completed",
    failed: "failed",
    refunded: "refunded",
    expired: "expired",
  };

  const newStatus = statusMap[payment_status] || "pending";
  updateData.status = newStatus;

  // ✅ Update transaction amount and currency based on actual payment
  if (newStatus === "completed") {
    // Use actually_paid if available, otherwise use price_amount
    const finalAmount =
      actually_paid !== undefined ? actually_paid : price_amount;
    const finalCurrency = price_currency || transaction.currency;

    if (finalAmount !== undefined) {
      updateData.amount = parseFloat(finalAmount);
    }
    if (finalCurrency) {
      updateData.currency = finalCurrency.toUpperCase();
    }
  }

  // ✅ Update description to include the selected payment method
  if (pay_currency && transaction.description) {
    const currentDescription = transaction.description;
    if (!currentDescription.includes(pay_currency.toUpperCase())) {
      updateData.description = `${currentDescription} via ${pay_currency.toUpperCase()}`;
    }
  }

  // ✅ Update transaction
  const updatedTransaction = await WalletTransaction.findByIdAndUpdate(
    { _id: transaction._id, status: { $ne: "completed" } },
    { $set: updateData },
    { new: true, runValidators: true }
  );

  if (!updatedTransaction) {
    throw new Error("Deposit transaction update failed");
  }

  console.log(
    `✅ Deposit transaction updated (status: ${newStatus}, method: ${
      pay_currency || "not selected"
    })`
  );

  // ✅ If completed and not already credited, credit wallet
  if (
    newStatus === "completed" &&
    transaction.userEmail &&
    !transaction.walletCredited
  ) {
    const creditAmount =
      actually_paid !== undefined ? actually_paid : price_amount;
    const creditCurrency =
      price_currency || pay_currency || transaction.currency;

    if (creditAmount && creditCurrency) {
      await creditUserWallet(
        transaction.userEmail,
        creditAmount.toString(),
        creditCurrency,
        order_id
      );
      console.log(`💰 Wallet credit initiated for ${transaction.userEmail}`);
    } else {
      console.error("❌ Missing amount or currency for wallet credit");
    }
  }

  // ✅ Send success response to NOW Payments
  res.status(200).json({
    success: true,
    message: "Deposit IPN processed successfully",
    status: newStatus,
    paymentMethod: pay_currency,
    transactionId: updatedTransaction._id,
  });
}

// KopoKopo Webhook Handler for Wallet Deposits
export const handleKopoKopoWebhook = async (req: Request, res: Response) => {
  try {
    console.log("======================================");
    console.log("📥 Incoming KopoKopo Webhook");
    console.log("🕓 Time:", new Date().toISOString());
    console.log("📦 Headers:", JSON.stringify(req.headers, null, 2));
    console.log("📦 Raw Body:", JSON.stringify(req.body, null, 2));
    console.log("======================================");

    const apiKey = process.env.K2_API_KEY;
    const signature = req.headers["x-kopokopo-signature"] as string;

    if (!signature) {
      console.error("❌ Missing X-KopoKopo-Signature header");
      res.status(401).json({ error: "Missing X-KopoKopo-Signature header" });
      return;
    }

    // Compute hash
    const rawBody = JSON.stringify(req.body);
    const hash = crypto
      .createHmac("sha256", apiKey as string)
      .update(rawBody)
      .digest("hex");

    console.log("🔑 Computed Hash:", hash);
    console.log("📜 Received Signature:", signature);

    if (hash !== signature) {
      console.error("❌ Signature mismatch — unauthorized request");
      res.status(401).json({ error: "Unauthorized request" });
      return;
    }

    const event = req.body?.data?.attributes?.event;
    const metadata = req.body?.data?.attributes?.metadata;
    const resource = event?.resource;

    console.log("📌 Event:", JSON.stringify(event, null, 2));
    console.log("📌 Metadata:", JSON.stringify(metadata, null, 2));
    console.log("📌 Resource:", JSON.stringify(resource, null, 2));

    if (!resource) {
      console.error("❌ Invalid webhook payload — missing resource");
      res.status(400).json({ error: "Invalid webhook payload" });
      return;
    }

    const { status, amount: paidAmount, currency } = resource;
    const orderId = metadata?.reference;

    if (!orderId) {
      console.error("❌ Missing orderId (reference) in metadata");
      res.status(400).json({ error: "Order ID (reference) not found" });
      return;
    }

    console.log(
      `🔄 Processing webhook for order ${orderId} — status: ${status}`
    );

    const transaction = await WalletTransaction.findOne({ orderId });
    console.log("💾 Found transaction:", transaction ? "✅ Yes" : "❌ No");

    if (!transaction) {
      console.error(`❌ Transaction not found for order: ${orderId}`);
      res.status(404).json({ error: "Transaction not found" });
      return;
    }

    if (transaction.status === "completed" && transaction.walletCredited) {
      console.warn(`⚠️ Transaction ${orderId} already completed — skipping.`);
      res.status(200).json({ success: true, message: "Already completed" });
      return;
    }

    const statusMap: Record<string, string> = {
      Received: "completed",
      Failed: "failed",
      Pending: "pending",
      Reversed: "refunded",
    };

    const newStatus = statusMap[status] || "pending";
    console.log(`🔁 Status mapped to: ${newStatus}`);

    if (newStatus === "failed") {
      await WalletTransaction.findOneAndUpdate(
        { orderId },
        { $set: { status: "failed" } }
      );
      console.warn(`⚠️ Transaction ${orderId} marked as failed`);
      res.status(400).json({ error: "Payment status is not Success" });
      return;
    }

    const updateData: Record<string, any> = {
      status: newStatus,
      "mpesaData.lastWebhookUpdate": new Date(),
      "mpesaData.paymentStatus": status,
    };

    if (newStatus === "completed" && paidAmount && currency) {
      updateData.amount = parseFloat(paidAmount);
      updateData.currency = "USD";
    }

    if (resource.sender_phone_number) {
      updateData.description = `M-Pesa deposit from ${resource.sender_phone_number}`;
      updateData.counterparty = resource.sender_phone_number;
    }

    updateData.mpesaData = {
      ...transaction.mpesaData,
      processed: newStatus === "completed",
      senderPhoneNumber: resource.sender_phone_number,
      senderFirstName: resource.sender_first_name,
      senderLastName: resource.sender_last_name,
      originationTime: new Date(resource.origination_time || Date.now()),
      tillNumber: resource.till_number,
      lastWebhookUpdate: new Date(),
      paidAmount,
      paidCurrency: currency,
    };

    console.log("🧾 Update Data:", JSON.stringify(updateData, null, 2));

    const updatedTransaction = await WalletTransaction.findOneAndUpdate(
      { orderId, status: { $ne: "completed" } },
      { $set: updateData },
      { new: true, runValidators: true }
    );

    if (!updatedTransaction) {
      console.warn(
        `⚠️ Transaction ${orderId} already completed by another process`
      );
      res.status(200).json({ success: true, message: "Already processed" });
      return;
    }

    console.log("✅ Transaction updated successfully in DB");

    if (
      newStatus === "completed" &&
      transaction.userEmail &&
      !transaction.walletCredited
    ) {
      console.log(`💰 Crediting wallet for ${transaction.userEmail}`);
      await creditUserWallet(
        transaction.userEmail,
        transaction.amount.toString(),
        "USD",
        orderId
      );
      console.log("💳 Wallet credited successfully");
    }

    console.log(`✅ Webhook fully processed for order: ${orderId}`);
    console.log("======================================");

    res.status(200).json({
      success: true,
      message: "M-Pesa payment processed successfully",
      status: newStatus,
    });
    return;
  } catch (error: any) {
    console.error("❌ Error processing KopoKopo webhook:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Error processing webhook" });
      return;
    }
  }
};

/**
 * Credit user wallet on successful deposit
 */
async function creditUserWallet(
  email: string,
  amount: string,
  currency: string,
  orderId: string
) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const user = await User.findOne({ email }).session(session);
    if (!user) throw new Error(`User not found for email: ${email}`);

    // Ensure idempotency (no double-credit)
    const existingTx = await WalletTransaction.findOne({
      orderId,
      walletCredited: true,
    }).session(session);

    if (existingTx) {
      console.warn(`⚠️ Wallet for ${email} already credited for ${orderId}`);
      await session.abortTransaction();
      return;
    }

    // Update user balance
    await User.findOneAndUpdate(
      { email },
      {
        $inc: { walletBalance: Number(amount), paymentCount: 1 },
        $set: { lastTransactionDate: new Date() },
      },
      { session }
    );

    // Mark transaction as credited
    await WalletTransaction.findOneAndUpdate(
      { orderId },
      { $set: { walletCredited: true } },
      { session }
    );

    await session.commitTransaction();
    console.log(`💰 Wallet credited for ${email}: +${amount} ${currency}`);
  } catch (err) {
    await session.abortTransaction();
    console.error("❌ Wallet crediting failed:", err);
    throw err;
  } finally {
    session.endSession();
  }
}

/**
 * Get payment status from NOW Payments (for manual status checks)
 */
export const getNowPaymentStatus = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const { paymentId } = req.params;
    const userEmail = req.user?.email;

    if (!userEmail) {
      res.status(401).json({ message: "User not authenticated" });
      return;
    }

    if (!paymentId) {
      res.status(400).json({ message: "Payment ID is required" });
      return;
    }

    // ✅ Verify the transaction belongs to the user
    const transaction = await WalletTransaction.findOne({
      "nowPaymentsData.paymentId": paymentId,
      userEmail,
    });

    if (!transaction) {
      res.status(404).json({ message: "Transaction not found" });
      return;
    }

    // ✅ Get latest status from NOW Payments API
    const paymentStatus = await nowPaymentsService.getPaymentStatus(paymentId);

    res.json({
      success: true,
      paymentId,
      status: transaction.status,
      nowPaymentsStatus: paymentStatus.payment_status,
      transaction: {
        id: transaction._id,
        orderId: transaction.orderId,
        amount: transaction.amount,
        currency: transaction.currency,
        status: transaction.status,
      },
      paymentInfo: paymentStatus,
    });
  } catch (error) {
    handleServerError(res, error, "Error fetching NOW Payments status");
  }
};

export const createWithdrawal = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const {
      amount,
      currency,
      method,
      network,
      address,
      phoneNumber,
      addressTag,
      note,
      userEmail,
    } = req.body;

    if (!userEmail) {
      res.status(401).json({ message: "User not authenticated" });
      return;
    }

    if (!amount || !currency || !method) {
      res.status(400).json({
        message: "Amount, currency, and method are required",
      });
      return;
    }

    // Validate amount
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      res.status(400).json({ message: "Invalid amount" });
      return;
    }

    // Check user balance
    const user = await User.findOne({ email: userEmail });
    if (!user || user.walletBalance < amountNum) {
      res.status(400).json({ message: "Insufficient balance" });
      return;
    }

    // Generate unique order ID
    const orderId = await generateUniqueOrderId(WalletTransaction, "NW", 8);

    let transactionData: any = {
      userEmail,
      type: "withdrawal",
      method,
      amount: amountNum,
      currency: currency.toUpperCase(),
      fee: 0,
      status: "pending",
      date: new Date(),
      orderId,
    };

    // Handle different withdrawal methods
    if (method === "cryptocurrency") {
      if (!network || !address) {
        res.status(400).json({
          message:
            "Network and address are required for cryptocurrency withdrawals",
        });
        return;
      }

      // ✅ Map network to NOW Payments currency codes
      const getCurrencyCode = (network: string): string => {
        const currencyMap: { [key: string]: string } = {
          trc20: "usdttrc20",
          tron: "trx",
          bep20: "usdtbep20",
          bsc: "bnb",
          erc20: "usdterc20",
          ethereum: "eth",
          bitcoin: "btc",
        };

        const normalizedNetwork = network.toLowerCase();
        return currencyMap[normalizedNetwork] || normalizedNetwork;
      };

      const payoutCurrency = getCurrencyCode(network);

      // ✅ Prepare NOW Payments payout payload according to API docs
      const payoutPayload = {
        withdrawals: [
          {
            address: address,
            currency: payoutCurrency,
            amount: amountNum,
            ...(addressTag && { extra_id: addressTag }),
            ...(note && { payout_description: note }),
            unique_external_id: orderId,
          },
        ],
        ipn_callback_url: process.env.NOW_PAYMENTS_IPN_URL,
        ...(note && { payout_description: note }),
      };

      console.log(
        "📤 Creating NOW Payments payout:",
        JSON.stringify(payoutPayload, null, 2)
      );

      const payoutResponse = await nowPaymentsService.createPayout(
        payoutPayload
      );

      console.log("📥 NOW Payments payout response:", payoutResponse);

      // ✅ Validate payout response
      if (
        !payoutResponse ||
        !Array.isArray(payoutResponse) ||
        payoutResponse.length === 0
      ) {
        console.error("❌ Invalid payout response:", payoutResponse);
        res.status(400).json({
          message: "Invalid response from payment provider",
          details: payoutResponse,
        });
        return;
      }

      const payout = payoutResponse[0]; // Get first payout from array

      // ✅ Store NOW Payments payout data
      transactionData.nowPaymentsWithdrawalData = {
        payoutId: payout.id,
        withdrawalId: orderId,
        payoutStatus: payout.status,
        address: payout.address,
        amount: payout.amount,
        currency: payout.currency,
        extraId: addressTag,
        payoutDescription: note,
        uniqueExternalId: orderId,
        createdAt: new Date(),
      };

      transactionData.description = `Cryptocurrency withdrawal to ${address} (${network.toUpperCase()})`;
      transactionData.counterparty = address;
      transactionData.withdrawalInfo = {
        address: address,
        network: network,
        addressTag: addressTag,
        currency: payoutCurrency,
      };

      // ✅ Map NOW Payments status to our status
      const statusMap: { [key: string]: string } = {
        creating: "pending",
        waiting: "pending",
        processing: "processing",
        sending: "processing",
        finished: "completed",
        failed: "failed",
        rejected: "failed",
      };

      transactionData.status = statusMap[payout.status] || "pending";
    } else if (method === "mpesa") {
      if (!phoneNumber) {
        res
          .status(400)
          .json({ message: "Phone number is required for M-Pesa withdrawals" });
        return;
      }

      // For M-Pesa, we might use a different integration
      transactionData.mpesaData = {
        phoneNumber,
        orderId,
      };

      transactionData.description = `M-Pesa withdrawal to ${phoneNumber}`;
      transactionData.counterparty = phoneNumber;

      // TODO: Integrate with actual M-Pesa payout API
      // Simulate processing for now
      setTimeout(async () => {
        try {
          await WalletTransaction.findByIdAndUpdate(transaction._id, {
            status: "completed",
            "mpesaData.processed": true,
          });
          console.log(
            `M-Pesa withdrawal completed for user: ${userEmail}, amount: ${amount}`
          );
        } catch (error) {
          console.error("Error updating M-Pesa withdrawal:", error);
        }
      }, 5000);
    } else {
      res.status(400).json({ message: "Unsupported withdrawal method" });
      return;
    }

    const transaction = await WalletTransaction.create(transactionData);

    // ✅ Deduct from user balance immediately for withdrawals
    await User.findOneAndUpdate(
      { email: userEmail },
      { $inc: { walletBalance: -amountNum } }
    );

    res.json({
      success: true,
      message: "Withdrawal initiated successfully",
      transaction: {
        id: transaction._id,
        orderId: transaction.orderId,
        amount: transaction.amount,
        currency: transaction.currency,
        status: transaction.status,
        method: transaction.method,
        description: transaction.description,
        nowPaymentsWithdrawalData: transaction.nowPaymentsWithdrawalData,
      },
    });
  } catch (error: any) {
    console.error("Withdrawal creation error:", error);

    // ✅ Refund user balance if withdrawal creation failed
    if (req.user?.email) {
      try {
        await User.findOneAndUpdate(
          { email: req.user.email },
          { $inc: { walletBalance: parseFloat(req.body.amount) } }
        );
        console.log("💰 Refunded user balance after withdrawal failure");
      } catch (refundError) {
        console.error("Error refunding user balance:", refundError);
      }
    }

    // Provide more specific error messages
    if (error.response?.data) {
      console.error("NOW Payments API error:", error.response.data);
      res.status(400).json({
        message: "Withdrawal failed",
        details: error.response.data,
      });
      return;
    }

    handleServerError(res, error, "Error creating withdrawal");
  }
};

// Other existing functions remain the same...
export const createWalletTransaction = async (req: Request, res: Response) => {
  try {
    const {
      userEmail,
      type,
      method,
      amount,
      currency,
      description,
      counterparty,
      fee,
      withdrawalInfo,
      bonus,
    } = req.body;

    const transaction = await WalletTransaction.create({
      userEmail,
      type,
      method,
      amount,
      currency,
      description,
      counterparty,
      fee,
      withdrawalInfo,
      bonus,
      status: "pending",
      date: new Date(),
    });

    res.status(201).json({ success: true, transaction });
  } catch (error) {
    handleServerError(res, error, "Error creating wallet transaction");
  }
};

export const updateWalletTransaction = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    const transaction = await WalletTransaction.findByIdAndUpdate(
      id,
      updateData,
      { new: true }
    );

    if (!transaction) {
      res.status(404).json({ message: "Transaction not found" });
      return;
    }

    res.json({ success: true, transaction });
  } catch (error) {
    handleServerError(res, error, "Error updating wallet transaction");
  }
};

export const deleteWalletTransaction = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const transaction = await WalletTransaction.findByIdAndDelete(id);

    if (!transaction) {
      res.status(404).json({ message: "Transaction not found" });
      return;
    }

    res.json({ success: true, message: "Transaction deleted successfully" });
  } catch (error) {
    handleServerError(res, error, "Error deleting wallet transaction");
  }
};

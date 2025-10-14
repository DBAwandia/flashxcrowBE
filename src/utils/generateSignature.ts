import crypto from "crypto";

/**
 * Generates a SHA-256 signature for CoinPal API.
 */
export const generateSignatureForCreate = (
  secretKey: string,
  requestId: string,
  merchantNo: string,
  orderNo: string,
  orderAmount: number | string,
  orderCurrency: string | null | undefined // Allow null or undefined
): string => {
  const currency = orderCurrency ? String(orderCurrency).trim() : "";

  const rawString =
    String(secretKey).trim() +
    String(requestId).trim() +
    String(merchantNo).trim() +
    String(orderNo).trim() +
    orderAmount +
    currency;

  const signature = crypto.createHash("sha256").update(rawString).digest("hex");

  return signature;
};
export const generateSignatureForGet = (
  secretKey: string,
  reference: string,
  merchantNo: string,
  timestamp: string
): string => {
  // Concatenate values in the required order
  const rawString =
    String(secretKey).trim() +
    String(reference).trim() +
    String(merchantNo).trim() +
    String(timestamp).trim();

  // Generate SHA-256 signature
  const signature = crypto.createHash("sha256").update(rawString).digest("hex");

  return signature;
};

import crypto from "crypto";

/**
 * NOW Payments IPN signature verification with detailed logging
 * @param rawBody - Raw JSON string body (as received, not parsed)
 * @param signatureHeader - The value from the `x-nowpayments-sig` header
 * @param nowPaymentsSecret - Your NOW Payments IPN secret key
 */
export const verifyNowPaymentsSignature = (
  rawBody: string,
  signatureHeader: string,
  nowPaymentsSecret: string
): boolean => {
  console.log("=== 🧩 NOW PAYMENTS SIGNATURE VERIFICATION ===");
  console.log("📏 Raw body length:", rawBody.length);
  console.log(
    "🔐 Signature header:",
    signatureHeader.substring(0, 80) + "..."
  );

  try {
    // STEP 1: Sort the JSON object alphabetically (like in your paymentTracking)
    const parsedBody = JSON.parse(rawBody);
    
    function sortObject(obj: Record<string, any>): Record<string, any> {
      return Object.keys(obj)
        .sort()
        .reduce((result: Record<string, any>, key: string) => {
          result[key] =
            obj[key] && typeof obj[key] === "object" && !Array.isArray(obj[key])
              ? sortObject(obj[key])
              : obj[key];
          return result;
        }, {});
    }

    const sortedBody = sortObject(parsedBody);
    const sortedBodyString = JSON.stringify(sortedBody);
    
    console.log("\n=== 🔍 SORTED BODY DEBUG ===");
    console.log("Sorted body (sample):", sortedBodyString.substring(0, 120) + "...");
    console.log("Sorted body length:", sortedBodyString.length);

    // STEP 2: Create HMAC SHA512 hash using the secret key
    const expectedSignature = crypto
      .createHmac("sha512", nowPaymentsSecret)
      .update(sortedBodyString)
      .digest("hex");

    console.log("\n=== 🔐 SIGNATURE COMPARISON ===");
    console.log("✅ Expected signature:", expectedSignature.substring(0, 80) + "...");
    console.log("📨 Received signature:", signatureHeader.substring(0, 80) + "...");

    // STEP 3: Compare signatures using timing-safe comparison
    const isValid = crypto.timingSafeEqual(
      Buffer.from(expectedSignature),
      Buffer.from(signatureHeader)
    );

    if (isValid) {
      console.log("✅ NOW Payments signature verification PASSED!");
      return true;
    } else {
      console.error("❌ NOW Payments signature verification FAILED!");

      // Diagnostic information
      console.warn("⚠️ Likely causes:");
      console.warn(" - IPN secret key mismatch");
      console.warn(" - Body was modified during transmission");
      console.warn(" - Sorting algorithm difference");
      console.warn(" - Using wrong secret key");

      // Additional debug: Show first few characters for manual comparison
      console.log("🔎 Expected (first 32 chars):", expectedSignature.substring(0, 32));
      console.log("🔎 Received (first 32 chars):", signatureHeader.substring(0, 32));

      return false;
    }
  } catch (err: any) {
    console.error("💥 NOW Payments verification error:", err.message);
    return false;
  }
};

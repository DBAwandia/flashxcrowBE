
import crypto from "crypto";

/**
 * Correct Changelly signature verification with detailed logging
 * @param body - Raw JSON string body (as received, not parsed)
 * @param signatureHeader - The value from the `X-Signature` header
 * @param changellyPublicKey - Your Changelly *public key* (RSA) without PEM delimiters
 */
export const verifyChangellyCallbackSignature = (
  body: string,
  signatureHeader: string,
  changellyPublicKey: string
): boolean => {
  console.log("=== 🧩 CHANGELLY SIGNATURE VERIFICATION ===");
  console.log("📏 Raw body length:", body.length);
  console.log(
    "🔐 Signature header (start):",
    signatureHeader.substring(0, 80) + "..."
  );

  try {
    // STEP 1: Base64 decode the header and split
    const decodedHeader = Buffer.from(signatureHeader, "base64").toString("utf8");
    console.log("\n=== 🔍 DECODE DEBUG ===");
    console.log("Decoded header (utf8):", decodedHeader.substring(0, 150) + "...");

    // STEP 2: Split into signature + timestamp
    const [sigB64, timestampStr] = decodedHeader.split(":");
    if (!sigB64 || !timestampStr) {
      console.error("❌ Header not in expected 'signature:timestamp' format");
      return false;
    }

    const timestamp = parseInt(timestampStr, 10);
    console.log("🕒 Parsed timestamp:", timestamp);
    console.log("📅 As date:", new Date(timestamp * 1000).toISOString());

    // STEP 3: Convert signature base64 → buffer
    const signatureBuffer = Buffer.from(sigB64, "base64");

    // STEP 4: Create the correct payload = body + ":" + timestamp
    const payload = body + ":" + timestamp;
    console.log("🧾 Payload to verify (sample):", payload.substring(0, 120) + "...");
    console.log("Payload length:", payload.length);

    // STEP 5: Format the public key with PEM delimiters
    const publicKey = `-----BEGIN PUBLIC KEY-----\n${changellyPublicKey}\n-----END PUBLIC KEY-----\n`;
    
    // STEP 6: Create verifier and verify
    const verifier = crypto.createVerify("RSA-SHA256");
    verifier.update(payload);
    verifier.end();

    const isValid = verifier.verify(publicKey, signatureBuffer);

    if (isValid) {
      console.log("✅ Signature verification PASSED!");
      return true;
    } else {
      console.error("❌ Signature verification FAILED — mismatch detected!");

      // Diagnostic: hash comparison
      const localHash = crypto
        .createHash("sha256")
        .update(payload)
        .digest("base64");
      console.log("🔎 Local SHA256 (base64):", localHash.substring(0, 60) + "...");
      console.log("🔎 Signature (base64, from header):", sigB64.substring(0, 60) + "...");

      console.warn("⚠️ Likely causes:");
      console.warn(" - Body was modified (e.g. parsed & re-stringified)");
      console.warn(" - Wrong Changelly public key");
      console.warn(" - Using private key instead of public key");
      console.warn(" - Signature expired (old timestamp)");
      return false;
    }
  } catch (err: any) {
    console.error("💥 Verification error:", err.message);
    return false;
  }
};
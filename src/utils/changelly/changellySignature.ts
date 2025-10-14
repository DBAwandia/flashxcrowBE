import crypto from "crypto";

/**
 * Generates an RSA-SHA256 signature for Changelly API requests.
 * 
 * @param privateKey - RSA private key in PEM format
 * @param method - HTTP method (e.g., "POST")
 * @param path - API path (e.g., "/api/payment/v1/payments")
 * @param body - Request body object
 * @param window - Expiry window in seconds (default 3600)
 * @returns { signature: string; timestamp: number }
 */
export function generateChangellySignature(
  privateKey: string,
  method: string,
  path: string,
  body: Record<string, any>,
  window: number = 3600
): { signature: string; timestamp: number } {
  try {
    // Step 1: JSON stringify the body
    const bodyJSON = JSON.stringify(body || {});
    
    // Step 2: Encode body to Base64 (empty string if {})
    const bodyBase64 =
      bodyJSON && bodyJSON !== "{}"
        ? Buffer.from(bodyJSON).toString("base64")
        : "";

    // Step 3: Generate expiration timestamp (UNIX seconds)
    const timestamp = Math.floor(Date.now() / 1000) + window;

    // Step 4: Build payload string
    const payload = `${method}:${path}:${bodyBase64}:${timestamp}`;

    // Step 5: Create RSA-SHA256 signature
    const sign = crypto.createSign("RSA-SHA256");
    sign.update(payload);
    sign.end();
    const rawSignature = sign.sign(privateKey, "base64");

    // Step 6: Append timestamp and encode final signature
    const combined = `${rawSignature}:${timestamp}`;
    const finalSignature = Buffer.from(combined).toString("base64");

    return { signature: finalSignature, timestamp };
  } catch (err) {
    throw new Error(
      `Failed to generate Changelly signature: ${
        err instanceof Error ? err.message : "Unknown error"
      }`
    );
  }
}

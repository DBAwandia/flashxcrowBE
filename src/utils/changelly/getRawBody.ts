// utils/changelly/getRawBody.ts
export const getRawBody = (req: any): string => {
  console.log("🔍 Checking for raw body sources...");

  // DIRECT ACCESS - no processing
  if (req.rawBody) {
    console.log("✅ Using req.rawBody directly");
    console.log("📏 Raw body length:", req.rawBody.length);
    console.log("🔍 Raw body sample:", req.rawBody.substring(0, 100));
    return req.rawBody;
  }

  // If no rawBody, something is wrong with middleware
  console.log("❌ req.rawBody not found!");
  console.log("Available properties:", Object.keys(req).filter(key => 
    key.includes('body') || key.includes('raw')
  ));
  
  throw new Error("Raw body not available - check middleware order");
};
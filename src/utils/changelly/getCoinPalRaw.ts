export const getCoinPalRaw = (req: Request) => {
  if (req.body) {
    return req.body;
  }
  // Fallback to the body if raw parsing was used
  if (req.body && Buffer.isBuffer(req.body)) {
    return req.body;
  }
  throw new Error("Raw body not available");
};

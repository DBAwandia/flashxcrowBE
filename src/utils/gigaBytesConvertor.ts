export const gbToBytes = (gb: number) => {
  return gb * 1000000000; // 1 GB = 1,000,000,000 bytes (SI system)
};

export const bytesToGB = (gb: number) => {
  return gb / 1000000000; // 1 GB = 1,000,000,000 bytes (SI system)
};

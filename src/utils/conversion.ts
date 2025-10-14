// ✅ Currency conversion - convert KES to USD for wallet operations
    export const exchangeRate = 130; // KES to USD rate

    export const convertToUSD = (value: number, curr: string): number => {
      if (curr.toUpperCase() === "KES") {
        return value / exchangeRate;
      }
      return value; // Already USD
    };
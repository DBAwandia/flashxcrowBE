// invoiceService.ts
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const baseURL = process.env.COIN_PAL_URL;

if (!baseURL) {
  throw new Error("COIN_PAL_URL is not defined in the environment variables");
}

// Create an Axios instance for consistent API requests.
const axiosInstance = axios.create({
  baseURL,
});

/**
 * Create an invoice.
 * @param invoiceData - An object containing invoice details (e.g., amount, currency, description, etc.)
 * @returns The created invoice data from the API.
 */
export const createInvoiceService = async (invoiceData: any): Promise<any> => {
  const response = await axiosInstance.post("/pay/checkout", invoiceData);
  return response.data;
};

export const getPaymentStatusService = async (queryData: any): Promise<any> => {
  const response = await axiosInstance.post("/pay/query", queryData);
  return response.data;
};

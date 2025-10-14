// invoiceService.ts
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const baseURL = process.env.PAY_STACK_URL;
const API_SECRET_KEY = process.env.PAY_STACK_SECRET_KEY;
if (!baseURL) {
  throw new Error("PAY_STACK_URL is not defined in the environment variables");
}

// Create an Axios instance for consistent API requests.
const axiosInstance = axios.create({
  baseURL,
  headers: {
    Authorization: `Bearer ${API_SECRET_KEY}`, // Add "Bearer" before the key
    Accept: "application/json",
    "Content-Type": "application/json",
  },
  timeout: 10000,
});

/**
 * Create an invoice.
 * @param invoiceData - An object containing invoice details (e.g., amount, currency, description, etc.)
 * @returns The created invoice data from the API.
 */
export const createChargeService = async (invoiceData: any): Promise<any> => {
  try {
    const response = await axiosInstance.post("/charge", invoiceData);
    // console.log("Charge Response Data:", response.data); // Log only response data

    return response.data; // Corrected "data" casing
  } catch (error: any) {
    // console.error(
    //   "Error creating charge:",
    //   error.response ? error.response.data : error.message
    // );
    throw error; // Re-throw error for handling at a higher level
  }
};

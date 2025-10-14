// services/nowPayments/nowPaymentsService.ts
import axios from "axios";

const NOW_PAYMENTS_API_KEY = process.env.NOW_PAYMENTS_API_KEY;
const NOW_PAYMENTS_BASE_URL =
  process.env.NOW_PAYMENTS_BASE_URL || "https://api.nowpayments.io/v1";

const axiosInstance = axios.create({
  baseURL: NOW_PAYMENTS_BASE_URL,
  headers: {
    "x-api-key": NOW_PAYMENTS_API_KEY,
    "Content-Type": "application/json",
  },
  timeout: 30000,
});

export const nowPaymentsService = {
  async createInvoice(invoiceData: any) {
    try {
      const response = await axiosInstance.post("/invoice", invoiceData);
      return response.data;
    } catch (error: any) {
      console.error(
        "NOW Payments createInvoice error:",
        error.response?.data || error.message
      );
      throw error;
    }
  },

  async getPaymentStatus(paymentId: string) {
    try {
      const response = await axiosInstance.get(`/payment/${paymentId}`);
      return response.data;
    } catch (error: any) {
      console.error(
        "NOW Payments getPaymentStatus error:",
        error.response?.data || error.message
      );
      throw error;
    }
  },

  async getAuthToken() {
    const response = await axios.post(`${NOW_PAYMENTS_BASE_URL}/auth`, {
      email: process.env.NOW_PAYMENTS_ACCOUNT_EMAIL,
      password: process.env.NOW_PAYMENTS_ACCOUNT_PASSWORD,
    });
    return response.data.token; // JWT token
  },
  // ✅ Create payout (with JWT token flow)
  async createPayout(payoutData: any) {
    try {
      // Ensure email is present in the payload
      const payload = {
        email: process.env.NOW_PAYMENTS_ACCOUNT_EMAIL, // 👈 required
        ...payoutData,
      };

      const token = await this.getAuthToken();
      console.log(token);

      const response = await axios.post(
        `${NOW_PAYMENTS_BASE_URL}/payout`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${token}`, // ✅ JWT token from /auth
            "x-api-key": process.env.NOW_PAYMENTS_API_KEY, // ✅ API key from dashboard
            "Content-Type": "application/json",
          },
        }
      );

      console.log("✅ NOWPayments payout success:", response.data);
      return response.data;
    } catch (error: any) {
      console.error(
        "❌ NOWPayments createPayout error:",
        error.response?.data || error.message
      );
      throw error;
    }
  },

  async getCurrencies() {
    try {
      const response = await axiosInstance.get("/currencies");
      return response.data;
    } catch (error: any) {
      console.error(
        "NOW Payments getCurrencies error:",
        error.response?.data || error.message
      );
      throw error;
    }
  },
};

import axios from "axios";
import dotenv from "dotenv";
import express from "express";
dotenv.config();

const app = express();
app.use(express.json());

const retryDelay = 2000; // Initial delay of 2 seconds
const maxRetries = 3;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const getAccessToken = async (): Promise<string> => {
  try {
    const response = await axios.post(
      `${process.env.K2_BASE_URL}/oauth/token`,
      {
        client_id: process.env.K2_CLIENT_ID,
        client_secret: process.env.K2_CLIENT_SECRET,
        grant_type: "client_credentials",
      },
      {
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "ProvaisApp/1.0 (TokenService)", // ✅ Required
        },
      }
    );

    return response.data.access_token;
  } catch (error) {
    console.error("Error obtaining access token:", error);
    throw new Error("Failed to retrieve access token.");
  }
};
export const createKopoKopoChargeService = async (
  invoiceData: any,
  retries = 0
): Promise<any> => {
  try {
    const accessToken = await getAccessToken();

    const stkPayload = {
      payment_channel: invoiceData.payment_channel || "M-PESA STK Push",
      till_number: invoiceData.till_number,
      subscriber: {
        phone_number: invoiceData.subscriber?.phone,
        email: invoiceData.subscriber?.email,
      },
      amount: {
        currency: invoiceData.amount.currency,
        value: invoiceData.amount.value,
      },
      metadata: {
        reference: invoiceData?.orderId || "Unknown",
      },
      _links: {
        callback_url: invoiceData.links?.callback_url,
      },
    };

    const response = await axios.post(
      `${process.env.K2_BASE_URL}/api/v1/incoming_payments`,
      stkPayload,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "User-Agent": "ProvaisApp/1.0 (STKPush)", // Required by KopoKopo
        },
      }
    );

    return response?.status;
  } catch (error: any) {
    const status = error?.response?.status;

    if (status === 429) {
      console.warn("Too many requests (429). Retrying after delay...");
    } else if (status === 400) {
      console.error(
        "Bad Request (400) - Check request payload and required fields."
      );
    } else {
      console.error(
        "Error sending STK push:",
        error?.response?.data || error.message
      );
    }

    if (retries < maxRetries) {
      console.log(
        `Retrying in ${retryDelay / 1000} seconds... (Attempt ${retries + 1})`
      );
      await delay(retryDelay);
      return createKopoKopoChargeService(invoiceData, retries + 1);
    } else {
      throw new Error(
        status === 429
          ? "Too many requests. Please try again later."
          : "Failed to initiate STK push."
      );
    }
  }
};

// export const createKopoKopoChargeService = async (
//   invoiceData: any,
//   retries = 0
// ): Promise<any> => {
//   try {
//     const accessToken = await getAccessToken();

//     const stkOptions = {
//       tillNumber: invoiceData.till_number,
//       firstName: invoiceData.subscriber.first_name,
//       lastName: invoiceData.subscriber.last_name,
//       phoneNumber: invoiceData.subscriber.phone,
//       email: invoiceData.subscriber.email,
//       currency: invoiceData.amount.currency,
//       amount: invoiceData.amount.value,
//       callbackUrl: invoiceData.links.callback_url,
//       paymentChannel: "M-PESA STK Push",
//       accessToken: accessToken,
//       metadata: {
//         reference: invoiceData?.orderId,
//       },
//     };

//     const response = await StkService.initiateIncomingPayment(stkOptions);

//     // Check if the response contains a 429 status
//     if (response.error_code === 429) {
//       console.warn(
//         "Pending STK request detected. Please wait before retrying."
//       );

//       // Optionally, you can delay and retry after some time
//       if (retries < maxRetries) {
//         console.log(`Retrying in ${retryDelay / 1000} seconds...`);
//         await delay(retryDelay);
//         return createKopoKopoChargeService(invoiceData, retries + 1);
//       } else {
//         throw new Error("Too many requests. Please try again later.");
//       }
//     }

//     return response;
//   } catch (error: any) {

//     if (retries < maxRetries) {
//       console.log(`Retrying in ${retryDelay / 1000} seconds...`);
//       await delay(retryDelay);
//       return createKopoKopoChargeService(invoiceData, retries + 1);
//     } else {
//       throw error;
//     }
//   }
// };

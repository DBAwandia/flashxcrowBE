import axios from "axios";
import crypto from "crypto";
import { generateChangellySignature } from "../../utils/changelly/changellySignature";
import {
  ChangellyCreatePaymentPayload,
  ChangellyCreatePaymentResponse,
  ChangellyCreateWithdrawalPayload,
  ChangellyCreateWithdrawalResponse,
} from "./types";

export class ChangellyPayService {
  private readonly publicKey: string;
  private readonly privateKey: string;
  private readonly baseUrl: string;

  constructor() {
    if (!process.env.CHANGELY_PUBLIC_KEY || !process.env.CHANGELY_PRIVATE_KEY) {
      throw new Error("Changelly Pay credentials are missing");
    }

    this.publicKey = process.env.CHANGELY_PUBLIC_KEY.trim();
    const pk = process.env.CHANGELY_PRIVATE_KEY.trim();

    this.privateKey = pk.includes("BEGIN PRIVATE KEY")
      ? pk
      : `-----BEGIN PRIVATE KEY-----\n${pk}\n-----END PRIVATE KEY-----`;

    this.baseUrl =
      process.env.CHANGELY_BASE_URL || "https://api.pay.changelly.com";
  }

  private normalizeAndValidatePaymentPayload(
    payload: any
  ): ChangellyCreatePaymentPayload {
    const normalized: ChangellyCreatePaymentPayload = { ...payload };

    if (typeof normalized.nominal_amount === "number")
      normalized.nominal_amount = normalized.nominal_amount.toString();

    if (!normalized.nominal_currency || !normalized.nominal_amount)
      throw new Error("nominal_currency and nominal_amount are required");

    const amount = parseFloat(normalized.nominal_amount);
    if (isNaN(amount) || amount <= 0)
      throw new Error("nominal_amount must be a positive number");

    normalized.nominal_amount = amount.toFixed(8).replace(/\.?0+$/, "");
    return normalized;
  }

  private validateWithdrawalPayload(payload: ChangellyCreateWithdrawalPayload): void {
    if (!payload.amount || !payload.order_id || !payload.address) {
      throw new Error("amount, order_id, and address are required");
    }

    if (!payload.receive_currency && !payload.credit_currency && !payload.nominal_receive_currency) {
      throw new Error("One of receive_currency, credit_currency, or nominal_receive_currency is required");
    }

    if (!payload.customer_ip_address || !payload.customer_referer_domain) {
      console.warn("⚠️ customer_ip_address and customer_referer_domain will soon be mandatory");
    }
  }

  private async post<T>(path: string, payload: Record<string, any>): Promise<T> {
    const { signature } = generateChangellySignature(
      this.privateKey,
      "POST",
      path,
      payload
    );

    const headers = {
      "X-Api-Key": this.publicKey,
      "X-Signature": signature,
      "Content-Type": "application/json",
      "User-Agent": "ChangellyPayService/1.0.0",
    };

    const response = await axios.post<T>(`${this.baseUrl}${path}`, payload, {
      headers,
      timeout: 30000,
      validateStatus: (s) => s < 500,
    });

    return response.data;
  }

  async createPayment(
    payload: ChangellyCreatePaymentPayload
  ): Promise<ChangellyCreatePaymentResponse> {
    const path = "/api/payment/v1/payments";
    const normalizedPayload = this.normalizeAndValidatePaymentPayload(payload);
    return await this.post<ChangellyCreatePaymentResponse>(
      path,
      normalizedPayload
    );
  }

  async createPaymentWithNumber(
    nominal_currency: string,
    nominal_amount: number,
    extras?: Partial<ChangellyCreatePaymentPayload>
  ): Promise<ChangellyCreatePaymentResponse> {
    return this.createPayment({
      nominal_currency,
      nominal_amount: nominal_amount.toString(),
      order_id: crypto.randomUUID(),
      ...extras,
    });
  }

  async createWithdrawal(
    payload: ChangellyCreateWithdrawalPayload
  ): Promise<ChangellyCreateWithdrawalResponse> {
    const path = "/api/payment/v1/withdrawals";
    
    // Validate required fields
    this.validateWithdrawalPayload(payload);
    
    // Add idempotency key if not provided
    const withdrawalPayload = {
      idempotency_key: crypto.randomUUID(),
      ...payload,
    };

    return await this.post<ChangellyCreateWithdrawalResponse>(
      path,
      withdrawalPayload
    );
  }

  async getWithdrawalStatus(withdrawalId: string): Promise<any> {
    const path = `/api/payment/v1/withdrawals/${withdrawalId}`;
    
    const { signature } = generateChangellySignature(
      this.privateKey,
      "GET",
      path,
      {}
    );

    const headers = {
      "X-Api-Key": this.publicKey,
      "X-Signature": signature,
      "User-Agent": "ChangellyPayService/1.0.0",
    };

    const response = await axios.get(`${this.baseUrl}${path}`, {
      headers,
      timeout: 30000,
    });

    return response.data;
  }
}

export const changellyPayService = new ChangellyPayService();
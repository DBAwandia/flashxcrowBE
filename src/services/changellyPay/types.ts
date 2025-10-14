// types/changelly.types.ts

export interface ChangellyPaymentMethod {
  currency: string;
  network?: string;
}

export interface ChangellyRecommendedAmount {
  nominal: string;
}

export interface ChangellyCreatePaymentPayload {
  nominal_amount: any;
  title?: string;
  description?: string;
  order_id: string;
  customer_id?: string;
  customer_email?: string;
  payment_data?: Record<string, any>;
  nominal_currency: string;
  recommended_amount?: ChangellyRecommendedAmount;
  success_redirect_url?: string;
  failure_redirect_url?: string;
  pending_deadline_at?: string;
  payment_method?: ChangellyPaymentMethod;
  fees_payer?: "MERCHANT" | "CUSTOMER";
  checkout_template_id?: string;
  customer_ip_address?: string;
  customer_referer_domain?: string;
}

export interface ChangellyCreatePaymentResponse {
  id: string;
  order_id: string;
  status: string;
  payment_url?: string;
  amount?: string;
  currency?: string;
  created_at?: string;
  [key: string]: any; // To avoid breaking when Changelly adds new fields
}
// types.ts - Add these interfaces

export interface ChangellyCreateWithdrawalPayload {
  // One of these currency fields is required
  receive_currency?: string; // Currency credited to merchant
  credit_currency?: string; // Holding currency  
  nominal_receive_currency?: string; // Fiat currency that denominates crypto
  
  receive_network?: string; // Network code
  amount: string; // Withdrawal amount
  order_id: string; // Arbitrary operation ID
  address: string; // Deposit address
  address_tag?: string; // Address tag value
  customer_ip_address: string; // IP address of request sender
  customer_referer_domain: string; // URL domain where buyer is located
  idempotency_key?: string; // Unique key for idempotency
  note?: string; // Withdrawal text comment
}

export interface ChangellyCreateWithdrawalResponse {
  id: string;
  order_id: string;
  state: number;
  type: string;
  created_at: string;
  updated_at: string;
  receive_currency?: string;
  credit_currency?: string;
  nominal_receive_currency?: string;
  receive_network?: string;
  amount: string;
  address: string;
  address_tag?: string;
  tx_id?: string;
  // Add other fields as they appear in responses
  [key: string]: any; // Flexible to handle API changes
}
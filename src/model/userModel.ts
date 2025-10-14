import mongoose, { Schema, Document } from "mongoose";

export interface IClaimCode {
  code: string;
  percentage: number; // e.g. 10 = 10% share of fee
  expiresAt: Date;
  isActive: boolean;
  usageCount: number;
  maxUsage?: number;
}

export interface IUser extends Document {
  email: string;
  password: string;
  isAdmin: boolean;
  balance: number;
  walletBalance: number;
  walletFrozeBalance: number;
  hasDispute: boolean;
  isDisabled: boolean;
  resetOtp: string;
  roles?: mongoose.Types.ObjectId[];
  otpExpiry: Date;
  subUserId?: string;
  country?: string;
  city?: string;
  trafficAmount?: number;
  lastAmountGB?: number;
  lastTransactionDate?: Date;
  paymentCount?: number;
  username?: string; // 🧠 New field added here

  // 🧩 Claim codes directly attached to user
  claimCodes?: IClaimCode[];
}

const ClaimCodeSchema = new Schema<IClaimCode>(
  {
    code: { type: String, required: true },
    percentage: { type: Number, required: true, min: 0, max: 100 },
    expiresAt: { type: Date, required: true },
    isActive: { type: Boolean, default: true },
    usageCount: { type: Number, default: 0 },
    maxUsage: { type: Number, default: 1 },
  },
  { _id: false }
);

const UserSchema: Schema = new Schema(
  {
    email: { type: String, required: true, unique: true },
    username: { type: String, trim: true, required: true, unique: true }, // 🧠 Added username field here

    password: { type: String, required: true, select: false },
    isAdmin: { type: Boolean, required: true },
    isDisabled: { type: Boolean, required: true },
    balance: { type: Number, required: true, default: 0 },

    // 💰 Wallet-related fields
    walletBalance: { type: Number, default: 0 },
    walletFrozeBalance: { type: Number, default: 0 },
    hasDispute: { type: Boolean, default: false },

    subUserId: { type: String },
    resetOtp: { type: String },
    otpExpiry: { type: Date },
    country: { type: String },
    city: { type: String },
    trafficAmount: { type: Number },
    lastTransactionDate: { type: Date },
    lastAmountGB: { type: Number },
    paymentCount: { type: Number, default: 0 },

    roles: [
      {
        type: Schema.Types.ObjectId,
        ref: "Role",
        default: [],
      },
    ],

    // 🧩 Attach claim codes directly under user
    claimCodes: { type: [ClaimCodeSchema], default: [] },
  },
  { timestamps: true }
);

const User = mongoose.model<IUser>("User", UserSchema);
export default User;

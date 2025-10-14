import mongoose, { Schema, Document, Types } from "mongoose";

export interface ITransfers extends Document {
  fromEmail: string; // New field
  toEmail: string; // New field
  type: string; // New field
  amount: number; // In GB
  reverse?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const TransfersSchema: Schema = new Schema(
  {
    fromEmail: {
      // New field
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },

    toEmail: {
      // New field
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0.01,
    },
    type: {
      type: String,
      default: false,
    },
    reverse: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

const Transfers = mongoose.model<ITransfers>("Transfers", TransfersSchema);

export default Transfers;

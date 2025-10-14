import mongoose, { Schema, Document } from "mongoose";

export interface ISystem extends Document {
  identifier: string;
  systemName: string;
  isDowntime: boolean;
  status: string;
  checkedAt?: Date;
}

const SystemSchema: Schema = new Schema(
  {
    identifier: { type: String, required: true, unique: true },
    systemName: { type: String, required: true },
    isDowntime: { type: Boolean, required: true },
    status: {
      type: String,
      required: true,
      enum: ["online", "offline", "maintenance", "degraded"],
      default: "degraded",
    },
    checkedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

const System = mongoose.model<ISystem>("System", SystemSchema);
export default System;

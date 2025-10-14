import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import mongoose from "mongoose";
import userRoutes from "./routes/userRoutes";
import transactionRoutes from "./routes/transactionRoutes";
import proxyRoutes from "./routes/proxyRoutes";
import systemRoutes from "./routes/systemStatusRoute";
import paymentRoutes from "./routes/paymentRoutes";
import cookieParser from "cookie-parser";
import transferRoutes from "./routes/transfersRoutes";
import escrowTransactionRoutes from "./routes/escrow/transactionRoutes";
import escrowWalletTransactionRoutes from "./routes/escrow/walletRoutes";
// REMOVE: import { rawBodyMiddleware } from "./authenticate-middleware/rawBodyMiddleware";

dotenv.config();
const app = express();
app.use(cookieParser());

app.use(
  cors({
    origin: [
      "http://localhost:8080",
      "https://shadowmax-frontend.vercel.app",
      "https://shadowmaxproxy.com",
      "https://shadowgate.netlify.app",
      "https://ipinfo.io/json?token=e1ba6d6622c806",
    ],
    methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
    credentials: true,
  })
);

// REMOVE THESE:
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URL as string);

const db = mongoose.connection;
db.once("open", () => console.log("✅ MongoDB Connected"));
db.on("err", () => console.log("❌ MongoDB Connection Error"));

app.get("/", (req, res) => {
  res.send("Connected to backend");
});

// Routes
app.use("/api/v1/users", userRoutes);
app.use("/api/v1/transactions", transactionRoutes);
app.use("/api/v1/base", proxyRoutes);
app.use("/api/v1/payments", paymentRoutes);
app.use("/api/v1/system", systemRoutes);
app.use("/api/v1/transfers", transferRoutes);
app.use("/api/v1/escrow/transactions", escrowTransactionRoutes);
app.use("/api/v1/escrow/walletTransactions", escrowWalletTransactionRoutes);

const PORT = process.env.PORT;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

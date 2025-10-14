import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import bodyParser from "body-parser";
import mongoose from "mongoose";
import userRoutes from "../src/routes/userRoutes";
import transactionRoutes from "../src/routes/transactionRoutes";

dotenv.config();
const app = express();

app.use(
    cors({
      origin: ["https://shadowgate.netlify.app", "https://shadowmax-frontend.vercel.app"], // Allow frontend domains
      methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
      credentials: true,
      allowedHeaders: ["Content-Type", "Authorization"],
    })
  );
app.use(bodyParser.json());

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URL as string);

const db = mongoose.connection;
db.once("open", () => console.log("✅ MongoDB Connected"));
db.on("err", () => console.log("❌ MongoDB Connection Error"));

app.get("/" , (req , res) =>{
    res.send("Connected to backend")
})

// Routes
app.use("/v1/api/users", userRoutes);
app.use("/v1/api/transactions", transactionRoutes);

const PORT = process.env.PORT;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

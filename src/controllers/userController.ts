import { Request, Response } from "express";
import User from "../model/userModel";
import { handleServerError } from "../utils/handleServerError";
import CryptoJS from "crypto-js";
import jwt from "jsonwebtoken";
import nodemailer from "nodemailer";
import crypto from "crypto";
import moment from "moment";
import axios from "axios";
import { generatePassword } from "../utils/passwordGenerator";
import {
  createSubUserService,
  deleteSubUserByIdService,
} from "../services/proxyService";
import { formatProxyUsername } from "../utils/formartProxyUsername";
import {
  getRangeLabel,
  marketingTemplates,
  wrapEmailTemplate,
} from "../utils/emailGenerator";
import Transaction from "../model/transactionModel";

// Get all users
export const getUsers = async (req: Request, res: Response) => {
  try {
    const { page = 1, limit = 70, search = "", isDisabled } = req.query;

    const pageNumber = Number(page);
    const limitNumber = Number(limit);

    const filter: any = {};
    if (search) {
      filter.email = { $regex: search, $options: "i" };
    }
    if (isDisabled !== undefined) {
      filter.isDisabled = isDisabled === "true";
    }

    // Get this week's data
    const users = await User.find(filter)
      .sort({
        lastTransactionDate: -1,
        balance: -1,
        paymentCount: -1,
        createdAt: -1,
      })
      .skip((pageNumber - 1) * limitNumber)
      .limit(limitNumber)
      .select(
        "email isAdmin isDisabled balance createdAt updatedAt country city lastTransactionDate lastAmountGB paymentCount"
      ); // exclude resetOtp and otpExpiry

    const totalUsers = await User.countDocuments(filter);
    const allUsersCount = await User.countDocuments();
    const suspendedUsersCount = await User.countDocuments({ isDisabled: true });

    const totalBalance = await User.aggregate([
      { $group: { _id: null, total: { $sum: "$balance" } } },
    ]);

    // Get last week's data
    const lastWeekFilter = {
      createdAt: {
        $gte: moment().subtract(2, "weeks").startOf("week").toDate(),
        $lt: moment().subtract(1, "weeks").endOf("week").toDate(),
      },
    };

    const lastWeekUsers = await User.countDocuments(lastWeekFilter);
    const lastWeekSuspendedUsers = await User.countDocuments({
      ...lastWeekFilter,
      isDisabled: true,
    });

    const lastWeekTotalBalance = await User.aggregate([
      { $match: lastWeekFilter },
      { $group: { _id: null, total: { $sum: "$balance" } } },
    ]);

    const lastWeekBalance =
      lastWeekTotalBalance.length > 0 ? lastWeekTotalBalance[0].total : 0;

    // Function to calculate percentage change with + or - identifier
    const getPercentageChange = (current: number, previous: number) => {
      if (previous === 0) return current > 0 ? "+100%" : "0%"; // Handle zero division
      const change = (((current - previous) / previous) * 100).toFixed(2);
      return `${change.startsWith("-") ? "" : "+"}${change}%`; // Add "+" for positive values
    };

    const totalUsersChange = getPercentageChange(allUsersCount, lastWeekUsers);
    const suspendedUsersChange = getPercentageChange(
      suspendedUsersCount,
      lastWeekSuspendedUsers
    );
    const totalBalanceChange = getPercentageChange(
      totalBalance.length > 0 ? totalBalance[0].total : 0,
      lastWeekBalance
    );

    res.json({
      totalUsers,
      allUsersCount,
      suspendedUsersCount,
      totalBalance: totalBalance.length > 0 ? totalBalance[0].total : 0,
      page: pageNumber,
      totalPages: Math.ceil(totalUsers / limitNumber),
      users,
      statsChange: {
        totalUsersChange, // Now returns "+10%" or "-5%"
        suspendedUsersChange,
        totalBalanceChange,
      },
    });
  } catch (error) {
    handleServerError(res, error, "Error fetching users");
  }
};

// get user by id
export const getUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await User.findById(req.params.id).select(
      "email isAdmin isDisabled balance createdAt updatedAt subUserId walletBalance walletFrozeBalance claimCodes"
    );

    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    res.json(user);
  } catch (error) {
    handleServerError(res, error, "Error fetching user");
  }
};

export const createUser = async (req: Request, res: Response) => {
  try {
    const {
      email,
      password,
      balance,
      isDisabled,
      resetOtp,
      otpExpiry,
      country,
      username,
      city,
    } = req.body;

    if (!email || !password || !username) {
      console.warn("❌ Missing required fields:", {
        emailProvided: !!email,
        passwordProvided: !!password,
      });
      res.status(400).json({ message: "Email and password required" });
      return;
    }

    // Check if user already exists (by email or username)
    const existingUser = await User.findOne({
      $or: [{ email: email }, { username: username }],
    });

    if (existingUser) {
      let conflictField = existingUser.email === email ? "email" : "username";
      res.status(409).json({
        message: `User with this ${conflictField} already exists`,
      });
      return;
    }

    // Encrypt password
    let hashedPassword: string;
    try {
      hashedPassword = CryptoJS.AES.encrypt(
        password,
        process.env.CRYPTOJS_CIPHER as string
      ).toString();
    } catch (err) {
      res.status(500).json({ message: "Password encryption failed" });
      return;
    }

    // Generate proxy credentials
    const proxy_username = formatProxyUsername(username);
    const proxy_password = generatePassword(12);

    const subUserData = {
      proxy_username,
      proxy_password,
      is_traffic_limited: true,
      traffic_limit: 0,
    };

    let response;
    try {
      response = await createSubUserService(subUserData);
    } catch (err) {
      res.status(502).json({ message: "Sub-user creation failed" });
      return;
    }

    const subUserId = response?.payload?.id;
    if (!subUserId) {
      res
        .status(500)
        .json({ message: "User creation failed. Please try again." });
      return;
    }

    // Save new user
    const newUser = new User({
      email,
      password: hashedPassword,
      isAdmin: false,
      isDisabled,
      balance,
      resetOtp,
      otpExpiry,
      subUserId,
      country,
      city,
      username,
    });

    try {
      await newUser.save();
    } catch (err) {
      res.status(500).json({ message: "Database error. User not saved" });
      return;
    }

    res.status(201).json({ message: "Your account has been created." });
  } catch (error) {
    handleServerError(res, error, "Server Error, Please try again");
  }
};

// Login user
export const loginUser = async (req: Request, res: Response) => {
  try {
    const { login, password } = req.body; // Changed from 'email' to 'login'

    // Validate input
    if (!login || !password) {
      res
        .status(400)
        .json({ message: "Username/email and password are required" });
      return;
    }

    // Determine if login is email or username
    const isEmail = login.includes("@");
    const queryCondition = isEmail
      ? { email: login.toLowerCase().trim() }
      : { username: login.trim() };

    // Find user with case-insensitive search for email
    const userDoc = await User.findOne(queryCondition)
      .select("+password")
      .lean();

    if (!userDoc) {
      res.status(401).json({ message: "Invalid credentials" }); // Generic message for security
      return;
    }

    // Check if account is disabled
    if (userDoc.isDisabled) {
      res
        .status(403)
        .json({ message: "Account suspended. Please contact support." });
      return;
    }

    // Validate password exists
    if (!userDoc.password) {
      res
        .status(500)
        .json({ message: "User record is corrupted. Please contact support." });
      return;
    }

    // Decrypt and verify password
    const hashedPassword = CryptoJS.AES.decrypt(
      userDoc.password,
      process.env.CRYPTOJS_CIPHER as string
    );
    const originalPassword = hashedPassword.toString(CryptoJS.enc.Utf8);

    // Use timing-safe comparison (consider using bcrypt for future implementations)
    if (originalPassword !== password) {
      res.status(401).json({ message: "Invalid credentials" });
      return;
    }

    // Generate JWT Token
    const token = jwt.sign(
      {
        id: userDoc._id,
        email: userDoc.email,
        username: userDoc.username,
        isAdmin: userDoc.isAdmin,
      },
      process.env.JWT_SECRET as string,
      { expiresIn: "7d" }
    );

    // Set cookie with JWT
    res.cookie("authToken", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      sameSite: "none",
      domain:
        process.env.NODE_ENV === "production"
          ? ".shadowmaxproxy.com"
          : undefined,
    });

    // Remove sensitive fields before sending response
    const { password: _, otpExpiry, resetOtp, ...safeUserData } = userDoc;

    res.status(200).json({
      message: "You’re now signed in.",
      user: safeUserData,
      token,
    });
  } catch (error) {
    handleServerError(
      res,
      error,
      "Server error during login. Please try again."
    );
  }
};

// Logout user
export const logoutUser = async (req: Request, res: Response) => {
  try {
    // Get token from cookies or Authorization header
    const token =
      req.cookies?.authToken || req.headers.authorization?.split(" ")[1];

    if (!token) {
      res.status(200).json({ message: "Already logged out" });
      return;
    }

    // Option 1: Simple cookie clearing (stateless JWT)
    res.clearCookie("authToken", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "none",
      domain:
        process.env.NODE_ENV === "production"
          ? ".shadowmaxproxy.com"
          : undefined,
    });

    // Option 2: If you want to implement token blacklisting (see below)
    // await blacklistToken(token);

    res.status(200).json({ message: "Logout successful" });
  } catch (error) {
    console.error("Logout error:", error);
    res.status(500).json({ message: "Logout failed" });
  }
};

//Send OTP
export const sendResetOtp = async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    // Check if user exists
    const user = await User.findOne({ email: email });
    if (!user) {
      res
        .status(404)
        .json({ message: "Unauthorized. Please register to continue." });
      return;
    }

    // Generate OTP (6-digit random number)
    const otp = crypto.randomInt(100000, 999999).toString();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // OTP expires in 10 mins

    // Save OTP in DB
    await User.findOneAndUpdate(
      { email: email },
      { $set: { resetOtp: otp, otpExpiry: otpExpiry } }, // Update fields
      { new: true, runValidators: true } // Return updated user & validate fields
    );

    // Configure Nodemailer
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER, // Your email
        pass: process.env.EMAIL_PASS, // Your app password (not email password)
      },
    });

    // Send email
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: "Password Reset OTP",
      text: `Your OTP for password reset is: ${otp}. It expires in 10 minutes.`,
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; fontSize:"1rem">
          <h2 style="color: #007bff; fontSize:"bold">Password Reset Request</h2>
          <p>Your OTP for password reset is: <strong style="font-size: 1.1rem;">${otp}</strong></p>
          <p><b>Note:</b> This OTP expires in <strong>10 minutes</strong>. If you didn't request this, please ignore this email.</p>
          <br>
          <p>Regards,<br><strong>Shadowmax Support Team</strong></p>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);

    res.json({ message: "OTP sent to email" });
  } catch (error) {
    handleServerError(res, error, "Error Sending Otp");
  }
};

//Reset password with OTP
export const resetUserpassword = async (req: Request, res: Response) => {
  try {
    const { email, password, otp } = req.body;

    if (!email || !password) {
      res.status(400).json({ message: "Email and password required" });
      return;
    }

    // Find user
    const user = await User.findOne({ email: email });

    if (!user) {
      res
        .status(404)
        .json({ message: "User not found. Please register first." });
      return;
    }

    // Skip OTP check if user is an admin
    if (!user.isAdmin) {
      const currentTime = new Date();
      const otpExpiryTime = new Date(user.otpExpiry || "");

      if (otp !== user.resetOtp || currentTime > otpExpiryTime) {
        res.status(400).json({ message: "Invalid or expired OTP" });
        return;
      }
    }

    // Correctly encrypt the password
    const hashedPassword = CryptoJS.AES.encrypt(
      password,
      process.env.CRYPTOJS_CIPHER as string
    ).toString();

    // Update password in database
    await User.findOneAndUpdate(
      { email },
      { $set: { password: hashedPassword } },
      { new: true, runValidators: true }
    );

    // Reset OTP after successful password update
    await User.findOneAndUpdate(
      { email },
      { $set: { resetOtp: process.env.RESET_PASSWORD_AFTER_SUCCESS } },
      { new: true, runValidators: true }
    );

    res.json({ message: "Password reset successful" });
  } catch (error) {
    handleServerError(res, error, "Server Error, Please try again");
  }
};

export const resetPasswordWithCurrent = async (req: Request, res: Response) => {
  try {
    const { email, password, newPassword } = req.body;

    if (!email || !password) {
      res.status(400).json({ message: "Email and password required" });
      return;
    }

    // Find user
    const user = await User.findOne({ email }).select("+password").lean();

    if (!user) {
      res.status(403).json({ message: "User not found" });
      return;
    }

    // Decrypt stored password
    const decryptedBytes = CryptoJS.AES.decrypt(
      user?.password || "",
      process.env.CRYPTOJS_CIPHER as string
    );
    const originalPassword = decryptedBytes.toString(CryptoJS.enc.Utf8);

    if (originalPassword !== password) {
      res
        .status(403)
        .json({ message: "Password verification failed. Please try again." });
      return;
    }

    // Correctly encrypt the password
    const hashNewPassword = CryptoJS.AES.encrypt(
      newPassword,
      process.env.CRYPTOJS_CIPHER as string
    ).toString(); // Convert to string

    // Update password in database
    const updatedUser = await User.findOneAndUpdate(
      { email: email },
      { $set: { password: hashNewPassword } },
      { new: true, runValidators: true }
    );

    if (!updatedUser) {
      res
        .status(404)
        .json({ message: "User not found. Please register first." });
      return;
    }

    res.json({ message: "Password reset successful" });
  } catch (error) {
    handleServerError(res, error, "Server Error, Please try again");
  }
};

export const adminResetUserPassword = async (req: Request, res: Response) => {
  try {
    const { oldEmail, newEmail, password, isAdmin } = req.body;

    // Find user
    const user = await User.findOne({ email: oldEmail });

    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    // Encrypt the new password
    const hashedPassword = CryptoJS.AES.encrypt(
      password,
      process.env.CRYPTOJS_CIPHER as string
    ).toString();

    // Update the user's password
    await User.findOneAndUpdate(
      { email: oldEmail },
      { $set: { password: hashedPassword, email: newEmail, isAdmin: isAdmin } },
      { new: true, runValidators: true }
    );

    res.json({ message: "User updated successful" });
  } catch (error) {
    handleServerError(res, error, "Server Error, Please try again");
  }
};

// Edit user
export const updateUser = async (req: Request, res: Response) => {
  try {
    // Prevent balance from being updated
    const { ...updateData } = req.body;

    const user = await User.findById(req.params.id);
    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    // Prevent suspending admins
    if (user.isAdmin && req.body.isDisabled === true) {
      res.status(403).json({ message: "Admin users cannot be suspended" });
      return;
    }

    const updatedUser = await User.findByIdAndUpdate(
      req.params.id, // Find user by ID
      { $set: updateData }, // Update fields
      { new: true, runValidators: true } // Return updated user & validate fields
    );

    res.status(200).json(updatedUser);
  } catch (error) {
    handleServerError(res, error, "Server Error, Please try again");
  }
};

// Edit user
export const deleteUser = async (req: Request, res: Response) => {
  try {
    const user = await User.findOne({ _id: req.params.id });

    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    if (user?.isAdmin) {
      res.status(403).json({
        message: "Admin users cannot be Deleted, You are not authorized!",
      });
      return;
    }
    await User.findByIdAndDelete(req.params.id);
    await deleteSubUserByIdService(user?.subUserId as string); // Delete sub-user

    res.json({ message: "User deleted successful" });
  } catch (error) {
    handleServerError(res, error, "Server Error, Please try again");
  }
};

export const getUserLocation = async (req: Request, res: Response) => {
  try {
    const response = await axios.get(
      `https://ipinfo.io/json?token=${process.env.IPINFO_API_KEY}`
    );
    res.json(response.data);
  } catch (error) {
    handleServerError(res, error, "Internal Server Error");
  }
};

// Send marketing emails to all users
// In-memory tracker (resets on app restart — for persistence, use DB or Redis)
const emailedUsers: Set<string> = new Set();

export const sendMarketingEmailToAllUsers = async (
  req: Request,
  res: Response
) => {
  try {
    const { target, range } = req.body as {
      target: "user" | "transaction";
      range: "thisMonth" | "lastMonth" | "beforeLastMonth";
    };

    // Validate input
    if (!["user", "transaction"].includes(target)) {
      res.status(400).json({ message: "Invalid target specified" });
      return;
    }

    if (!["thisMonth", "lastMonth", "beforeLastMonth"].includes(range)) {
      res.status(400).json({ message: "Invalid date range specified" });
      return;
    }

    // Calculate date ranges
    // Calculate date ranges
    const now = new Date();
    const firstDayOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const firstDayOfLastMonth = new Date(
      now.getFullYear(),
      now.getMonth() - 1,
      1
    );
    const firstDayOfMonthBeforeLast = new Date(
      now.getFullYear(),
      now.getMonth() - 2,
      1
    );
    const firstDayOfNextMonth = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      1
    );

    let dateFilter = {};
    switch (range) {
      case "thisMonth":
        dateFilter = { $gte: firstDayOfThisMonth, $lt: firstDayOfNextMonth };
        break;
      case "lastMonth":
        dateFilter = { $gte: firstDayOfLastMonth, $lt: firstDayOfThisMonth };
        break;
      case "beforeLastMonth":
        dateFilter = { $lt: firstDayOfMonthBeforeLast }; // Now correctly excludes last month and this month
        break;
    }

    // Get appropriate users
    let users = [];
    if (target === "user") {
      users = await User.aggregate([
        { $match: { isDisabled: false, createdAt: dateFilter } },
        { $sample: { size: 10 } },
        { $project: { email: 1 } },
      ]);
    } else {
      users = await Transaction.aggregate([
        { $match: { createdAt: dateFilter, transactionStatus: "paid" } }, // fixed `status` to `transactionStatus`
        {
          $group: {
            _id: "$userId",
            lastTransactionDate: { $max: "$createdAt" },
          },
        },
        {
          $lookup: {
            from: "users",
            localField: "_id",
            foreignField: "_id",
            as: "user",
          },
        },
        { $unwind: "$user" },
        { $match: { "user.isDisabled": false } },
        { $sample: { size: 10 } },
        { $project: { email: "$user.email" } },
      ]);
    }

    if (users.length === 0) {
      res.status(404).json({
        message: `No ${
          target === "user" ? "users" : "transactions"
        } found for ${getRangeLabel(range)}.`,
      });
      return;
    }

    // Setup email transporter
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    const skipped: string[] = [];
    const sent: string[] = [];
    const failed: string[] = [];

    // Send emails with appropriate template
    for (const user of users) {
      const email = user.email;

      if (emailedUsers.has(email)) {
        skipped.push(email);
        continue;
      }

      const template = marketingTemplates[target][range];
      const mailOptions = {
        from: `"Shadowmax" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: template.subject,
        html: wrapEmailTemplate(template.html(email), email),
      };

      try {
        await transporter.sendMail(mailOptions);
        emailedUsers.add(email);
        sent.push(email);
      } catch (error) {
        console.error(`Failed to send to ${email}`, error);
        failed.push(email);
      }
    }

    res.status(200).json({
      message: `Campaign completed for ${target} ${range}`,
      stats: {
        total: users.length,
        sent: sent.length,
        skipped: skipped.length,
        failed: failed.length,
      },
      sent,
      skipped,
      failed,
    });
  } catch (error) {
    handleServerError(res, error, "Error sending marketing emails");
  }
};

// Add a claim code to a specific user
export const addClaimCode = async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const { code, percentage, expiresAt, maxUsage } = req.body;

    if (!code || !percentage || !expiresAt) {
      res
        .status(400)
        .json({ message: "Code, percentage and expiry date are required" });
      return;
    }

    // ✅ Check if the claim code already exists in ANY user
    const existingGlobal = await User.findOne({ "claimCodes.code": code });
    if (existingGlobal) {
      res.status(409).json({ message: "Claim code already exists" });
      return;
    }

    // ✅ Check if user exists
    const user = await User.findById(userId);
    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    // ✅ Double check in case user already has it (edge case)
    const existingUserCode = user?.claimCodes?.find(
      (c: any) => c.code === code
    );
    if (existingUserCode) {
      res
        .status(409)
        .json({ message: "Claim code already exists for this user" });
      return;
    }

    // ✅ Create new claim code
    const newClaimCode = {
      code,
      percentage,
      expiresAt: new Date(expiresAt),
      isActive: true,
      usageCount: 0,
      maxUsage: maxUsage || 1,
    };

    // ✅ Push atomically to avoid race conditions
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $push: { claimCodes: newClaimCode } },
      { new: true }
    );

    res.status(201).json({
      message: "Claim code added successfully",
      claimCode: newClaimCode,
      user: updatedUser,
    });
    return;
  } catch (error) {
    handleServerError(res, error, "Error adding claim code");
  }
};

// Update or deactivate a claim code
export const updateClaimCode = async (req: Request, res: Response) => {
  try {
    const { userId, code } = req.query;
    const { newCode, percentage, expiresAt, isActive, maxUsage } = req.body;

    // ✅ Check if user exists
    const user = await User.findById(userId);
    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    // ✅ Find the existing claim code inside user
    const claimCodeIndex = user?.claimCodes?.findIndex(
      (c: any) => c.code === code
    );
    if (claimCodeIndex === -1 || claimCodeIndex === undefined) {
      res.status(404).json({ message: "Claim code not found" });
      return;
    }

    // ✅ If changing code, check that the new one doesn't exist elsewhere
    if (newCode && newCode !== code) {
      const existingGlobal = await User.findOne({ "claimCodes.code": newCode });
      if (existingGlobal) {
        res
          .status(409)
          .json({ message: "New claim code already exists for another user" });
        return;
      }
      if (user.claimCodes) {
        user.claimCodes[claimCodeIndex].code = newCode;
      }
    }

    // ✅ Update provided fields
    if (!user.claimCodes) {
      res.status(500).json({ message: "Claim codes array is undefined" });
      return;
    }

    if (percentage !== undefined)
      user.claimCodes[claimCodeIndex].percentage = percentage;
    if (expiresAt !== undefined)
      user.claimCodes[claimCodeIndex].expiresAt = new Date(expiresAt);
    if (isActive !== undefined)
      user.claimCodes[claimCodeIndex].isActive = isActive;
    if (maxUsage !== undefined)
      user.claimCodes[claimCodeIndex].maxUsage = maxUsage;

    await user.save();

    res.status(200).json({
      message: "Claim code updated successfully",
      claimCode: user?.claimCodes[claimCodeIndex],
    });
    return;
  } catch (error) {
    handleServerError(res, error, "Error updating claim code");
  }
};

// Get all claim codes - returns active ones by default
export const getAllClaimCodes = async (req: Request, res: Response) => {
  try {
    const { includeInactive = "false" } = req.query;

    // Build filter for active claim codes by default
    let claimCodeFilter = {};

    if (includeInactive !== "true") {
      claimCodeFilter = {
        "claimCodes.isActive": true,
        "claimCodes.expiresAt": { $gt: new Date() },
      };
    }

    // Get all users with their claim codes
    const users = await User.find(claimCodeFilter).select(
      "username email claimCodes"
    );

    // Extract and flatten claim codes with user info
    const allClaimCodes: any[] = [];

    users.forEach((user) => {
      if (user.claimCodes && user.claimCodes.length > 0) {
        user.claimCodes.forEach((claimCode: any) => {
          // Apply additional filtering at application level if needed
          if (includeInactive !== "true") {
            // Double check for active and non-expired codes
            if (
              claimCode.isActive &&
              new Date(claimCode.expiresAt) > new Date()
            ) {
              allClaimCodes.push({
                ...(claimCode.toObject?.() || claimCode),
                user: {
                  id: user._id,
                  email: user.email,
                },
              });
            }
          } else {
            // Include all codes (active and inactive)
            allClaimCodes.push({
              ...(claimCode.toObject?.() || claimCode),
              user: {
                id: user._id,
                email: user.email,
              },
            });
          }
        });
      }
    });

    res.status(200).json({
      message: "Claim codes retrieved successfully",
      claimCodes: allClaimCodes,
      count: allClaimCodes.length,
      filters: {
        includeInactive: includeInactive === "true",
      },
    });
    return;
  } catch (error) {
    handleServerError(res, error, "Error retrieving claim codes");
  }
};

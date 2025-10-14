import { Request, Response } from "express";
import User from "../../src/model/userModel";
import { handleServerError } from "../../src/utils/handleServerError";
import CryptoJS from "crypto-js";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import nodemailer from "nodemailer";
import crypto from "crypto";
import moment from "moment";
import axios from "axios";

import { generatePassword } from "../../src/utils/passwordGenerator";

dotenv.config();

const baseURL = process.env.BASE_URL;
const API_KEY = process.env.API_KEY;

// Get all users
export const getUsers = async (req: Request, res: Response) => {
  try {
    const { page = 1, limit = 20, search = "", isDisabled } = req.query;

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
      .sort({ balance: -1 })
      .skip((pageNumber - 1) * limitNumber)
      .limit(limitNumber)
      .select(
        "email isAdmin isDisabled balance createdAt updatedAt country city"
      ); // Include resetOtp and otpExpiry

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
      "email isAdmin isDisabled balance createdAt updatedAt subUserId"
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

// Register a new user
export const createUser = async (req: Request, res: Response) => {
  try {
    const {
      email,
      password,
      isAdmin,
      balance,
      isDisabled,
      resetOtp,
      otpExpiry,
      country,
      city,
    } = req.body;

    if (!email || !password) {
      res.status(400).json({ message: "Email and password required" });
      return;
    }

    if (!API_KEY) {
      res.status(400).json({ message: "API Key is missing" });
      return;
    }

    // Check if the user already exists
    const isUserAlreadyRegistered = await User.findOne({ email });
    if (isUserAlreadyRegistered) {
      res.status(409).json({ message: "User already exists" });
      return;
    }

    // ✅ Generate proxy_username from email
    const proxy_username = email.replace(/[@.]/g, "_"); // Convert email to username format

    // ✅ Encrypt password
    const hashedPassword = CryptoJS.AES.encrypt(
      password,
      process.env.CRYPTOJS_CIPHER as string
    ).toString();

    // ✅ Generate random password for the sub-user
    const proxy_password = generatePassword(12);

    // ✅ Create Sub-user (proxy user)
    const subUserData = {
      proxy_username,
      proxy_password,
      is_traffic_limited: true,
      traffic_limit: 0,
    };

    const url = `${baseURL}/sub-users/`;

    try {
      const response = await axios.post(url, subUserData, {
        headers: {
          Authorization: `x-api-key ${API_KEY}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      });

      // Extract subUserId from the response
      const subUserId = response?.data?.id;

      // ✅ Create User in the database
      const newUser = new User({
        email,
        password: hashedPassword,
        isAdmin,
        isDisabled,
        balance,
        resetOtp,
        otpExpiry,
        country,
        city,
        subUserId: subUserId, // ✅ Store the subUserId in the user model
        proxy_username, // ✅ Store generated username
      });

      await newUser.save();

      return res.status(201).json({
        message: "User created successfully",
        user: newUser,
      });
    } catch (error) {
      return handleServerError(res, error, "Error creating sub-user");
    }
  } catch (error) {
    return handleServerError(res, error, "Error creating user");
  }
};

// Login user
export const loginUser = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ message: "Email and password required" });
      return;
    }

    const userDoc = await User.findOne({ email: email })
      .select("+password")
      .lean();

    if (!userDoc) {
      res
        .status(401)
        .json({ message: "Unauthorized. Please register to continue." });
    }

    if (userDoc?.isDisabled) {
      res
        .status(403)
        .json({ message: "Account suspended. Please contact support." });
      return;
    }

    if (!userDoc?.password) {
      res
        .status(500)
        .json({ message: "User record is corrupted. No password found." });
      return;
    }

    // Decrypt stored password
    const hashedPassword = CryptoJS.AES.decrypt(
      userDoc?.password || "",
      process.env.CRYPTOJS_CIPHER as string
    );

    const originalPassword = hashedPassword.toString(CryptoJS.enc.Utf8);

    if (originalPassword !== password) {
      res.status(403).json({ message: "Invalid credentials" });
      return;
    }

    if (!userDoc?.password) {
      res
        .status(500)
        .json({ message: "User record is corrupted. No password found." });
      return;
    }
    // Generate JWT Token
    const token = jwt.sign(
      { id: userDoc?._id, email: userDoc?.email }, // Payload
      process.env.JWT_SECRET as string, // Secret key
      { expiresIn: "7d" } // Token expiry
    );

    // Set cookie with JWT
    res.cookie("authToken", token, {
      httpOnly: true, // Prevents client-side JavaScript access
      secure: process.env.NODE_ENV === "production", // HTTPS in production
      sameSite: "none", // CSRF protection
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    // Remove sensitive fields before sending response
    const { password: _, otpExpiry, resetOtp, ...safeUserData } = userDoc;

    res.json({ message: "Login successful", user: safeUserData, token });
  } catch (error) {
    handleServerError(res, error, "Error logging In");
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
          <p>Regards,<br><strong>ShadowMax Support Team</strong></p>
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
    handleServerError(res, error, "Error Resetting Password");
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
    handleServerError(res, error, "Error Reseting Password");
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
    handleServerError(res, error, "Error resetting user password by admin");
  }
};

// Edit user
export const updateUser = async (req: Request, res: Response) => {
  try {
    // Prevent balance from being updated
    const { balance, ...updateData } = req.body;

    const updatedUser = await User.findByIdAndUpdate(
      req.params.id, // Find user by ID
      { $set: updateData }, // Update fields
      { new: true, runValidators: true } // Return updated user & validate fields
    );

    if (!updatedUser) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    res.status(200).json(updatedUser);
  } catch (error) {
    handleServerError(res, error, "Error updating user");
  }
};

// Edit user
export const deleteUser = async (req: Request, res: Response) => {
  try {
    await User.findByIdAndDelete(req.params.id);

    res.json({ message: "User deleted successful" });
  } catch (error) {
    handleServerError(res, error, "Error Deleting user");
  }
};

export const getUserLocation = async (req: Request, res: Response) => {
  try {
    const response = await axios.get(
      `https://ipinfo.io/json?token=${process.env.IPINFO_API_KEY}`
    );
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch location" });
  }
};

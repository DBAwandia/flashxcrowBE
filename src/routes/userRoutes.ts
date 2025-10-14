import express from "express";
import {
  getUsers,
  createUser,
  loginUser,
  getUser,
  updateUser,
  resetUserpassword,
  deleteUser,
  sendResetOtp,
  resetPasswordWithCurrent,
  adminResetUserPassword,
  getUserLocation,
  logoutUser,
  updateClaimCode,
  addClaimCode,
  sendMarketingEmailToAllUsers,
  getAllClaimCodes,
} from "../controllers/userController";
import {
  adminAndUserOnly,
  adminOnly,
  authenticate,
} from "../authenticate-middleware/middleware";

const router = express.Router();

router.get("/", authenticate, adminOnly, getUsers); // Only admin can get all users
router.get("/user/:id", authenticate, getUser); // User & admin can get user details
router.post("/register", createUser); // Open to all
router.post("/login", loginUser); // Open to all
router.post("/logout", authenticate, logoutUser);
router.post("/sendOtp", sendResetOtp); // Open to all
router.put("/resetPassword", resetUserpassword); // Open to all
router.put("/resetPasswordWithCurrent", resetPasswordWithCurrent); // User must be logged in
router.put(
  "/adminResetPassword",
  authenticate,
  adminAndUserOnly,
  adminResetUserPassword
); // Only admin can reset passwords
router.put("/update/:id", updateUser); // Users & admin can update user
router.delete("/delete/:id", authenticate, adminOnly, deleteUser); // Only admin can delete user
router.get("/user-meta", getUserLocation);
router.post(
  "/users/marketing",
  authenticate,
  adminOnly,
  sendMarketingEmailToAllUsers
);

// ✅ CLAIM CODE ROUTES
router.post(
  "/claim-code/create/:userId",
  authenticate,
  adminOnly,
  addClaimCode
); // Create new claim code for a user
router.put("/claim-code/update", authenticate, adminOnly, updateClaimCode); // Update existing claim code
router.get("/claim-codes", authenticate, getAllClaimCodes);

export default router;

import express from "express";
import {
  createSubUser,
  deleteSubUser,
  getAllLocations,
  getCities,
  getCountries,
  getIsps,
  getMyInformation,
  getRegions,
  getStatisticsData,
  getSubUsers,
  getSubuserStats,
  getWhitelistIpById,
  getWhitelistIps,
  getZipCodes,
  updateSubUser,
  updateSubuserPassword,
} from "../controllers/proxyController";
import { authenticate, adminOnly } from "../authenticate-middleware/middleware";

const router = express.Router();

// Protected Routes (Require Authentication)
router.get("/locations/all-doc", authenticate, getAllLocations);
router.get("/locations/countries", authenticate, getCountries);
router.get("/locations/regions", authenticate, getRegions);
router.get("/locations/cities", authenticate, getCities);
router.get("/locations/isps", authenticate, getIsps);
router.get("/statistics/data", authenticate, getStatisticsData);
router.get("/locations/zipcodes", authenticate, getZipCodes);

// Sub-user management (Admin & User Access)
router.get("/statistics", authenticate, getSubuserStats);
router.get("/sub-users", authenticate, getSubUsers);
router.put("/update-password/user", authenticate, updateSubuserPassword);
router.get("/users/my-information", authenticate, getMyInformation);
router.post("/create/sub-users", createSubUser);
router.put("/edit/sub-users", authenticate, updateSubUser);
router.delete("/delete/sub-users/:id", authenticate, adminOnly, deleteSubUser);

// Whitelist IP management (Admin Only)
router.get("/whitelist/ips", authenticate, getWhitelistIps);
router.get("/whitelist/ip/:id", authenticate, getWhitelistIpById);

export default router;

import { Request, Response } from "express";
import dotenv from "dotenv";
import User from "../model/userModel";
import { handleServerError } from "../utils/handleServerError";
import { generatePassword } from "../utils/passwordGenerator";
import { bytesToGB, gbToBytes } from "../utils/gigaBytesConvertor";
import {
  createSubUserService,
  deleteSubUserByIdService,
  getCitiesService,
  getIspsService,
  getMyInformationService,
  getRegionsService,
  getSubUsersService,
  getSubuserStatisticsService,
  getZipCodesService,
  updateSubUserService,
} from "../services/proxyService";
import Transfers from "../model/transfersModel";

dotenv.config();

const baseURL = process.env.BASE_URL;
const API_KEY = process.env.NODEMAVEN_API_KEY;

export const getAllLocations = async (
  req: Request,
  res: Response
): Promise<void> => {
  if (!API_KEY) {
    res.status(400).json({ message: "API Key is missing" });
    return;
  }

  try {
    const response = await fetch(`${baseURL}/locations/all/`, {
      method: "GET",
      headers: {
        Authorization: `x-api-key ${API_KEY}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const errorData = await response.json();
      res
        .status(response.status)
        .json({ message: errorData?.detail || "Failed to fetch countries" });
      return;
    }

    const data = await response.json();
    res.status(200).json(data);
  } catch (err) {
    handleServerError(res, err, "Failed to fetch Countries");
  }
};

export const getCountries = async (
  req: Request,
  res: Response
): Promise<void> => {
  if (!API_KEY) {
    res.status(400).json({ message: "API Key is missing" });
    return;
  }
  const name = req.query.countryName;
  const limit = req.query.limit;

  try {
    const response = await fetch(
      `${baseURL}/locations/countries/?limit=${limit}&name=${name}`,
      {
        method: "GET",
        headers: {
          Authorization: `x-api-key ${API_KEY}`,
          Accept: "application/json",
        },
      }
    );

    if (!response.ok) {
      const errorData = await response.json();
      res
        .status(response.status)
        .json({ message: errorData?.detail || "Failed to fetch countries" });
      return;
    }

    const data = await response.json();
    res.status(200).json(data);
  } catch (err) {
    handleServerError(res, err, "Server Error - Clear all selects and retry");
  }
};

export const getRegions = async (
  req: Request,
  res: Response
): Promise<void> => {
  if (!API_KEY) {
    res.status(400).json({ message: "API Key is missing" });
    return;
  }
  const country = req.query.countryCode;
  const limit = req.query.limit;
  const connection = req.query.connection;

  try {
    const response = await getRegionsService(
      country as string,
      limit as any,
      connection as string
    );
    res.status(200).json(response);
  } catch (err) {
    handleServerError(res, err, "Server Error - Clear all selects and retry");
  }
};

export const getCities = async (req: Request, res: Response): Promise<void> => {
  if (!API_KEY) {
    res.status(400).json({ message: "API Key is missing" });
    return;
  }

  const country = req.query.countryCode;
  const limit = req.query.limit;
  const region = req.query.regionCode;
  const connection = req.query.connection;

  try {
    const response = await getCitiesService(
      country as string,
      region as string,
      limit as any,
      connection as string
    );
    res.status(200).json(response);
  } catch (err) {
    handleServerError(res, err, "Server Error - Clear all selects and retry");
  }
};

export const getIsps = async (req: Request, res: Response): Promise<void> => {
  const country = req.query.countryCode;
  const region = req.query.regionCode;
  const city = req.query.cityCode;
  const connection = req.query.connection;

  try {
    const response = await getIspsService(
      country as string,
      region as string,
      city as string,
      connection as string
    );
    res.status(200).json(response);
  } catch (err) {
    handleServerError(res, err, "Server Error - Clear all selects and retry");
  }
};

export const getZipCodes = async (
  req: Request,
  res: Response
): Promise<void> => {
  const country = req.query.countryCode;
  const region = req.query.regionCode;
  const city = req.query.cityCode;
  const connection = req.query.connection;

  try {
    const response = await getZipCodesService(
      country as string,
      region as string,
      city as string,
      connection as string
    );
    res.status(200).json(response);
  } catch (err) {
    handleServerError(res, err, "Server Error - Clear all selects and retry");
  }
};

export const getStatisticsData = async (
  req: Request,
  res: Response
): Promise<void> => {
  if (!API_KEY) {
    res.status(400).json({ message: "API Key is missing" });
    return;
  }

  try {
    const response = await fetch(`${baseURL}/statistics/data/`, {
      method: "GET",
      headers: {
        Authorization: `x-api-key ${API_KEY}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const errorData = await response.json();
      res
        .status(response.status)
        .json({ message: errorData?.detail || "Failed to fetch statistics" });
      return;
    }

    const data = await response.json();
    res.status(200).json(data);
  } catch (err) {
    handleServerError(res, err, "Failed to fetch Statistics");
  }
};

export const getSubuserStats = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const {
      proxy_username,
      period,
      timezone,
      // request_source,
      start,
      end,
    } = req.query;

    // Construct query string
    const queryParams = new URLSearchParams({
      ...(proxy_username && { proxy_username: String(proxy_username) }),
      limit: "100", // Always include limit
      ...(period &&
        period !== "7days" &&
        period !== "month" && { period: String(period) }), // Exclude if '7days' or 'month'
      ...(timezone && { timezone: String(timezone) }),
      // Include start and end only if period is NOT 'hours24' or 'today'
      ...((!period || (period !== "hours24" && period !== "today")) &&
        start && { start: String(start) }),
      ...((!period || (period !== "hours24" && period !== "today")) &&
        end && { end: String(end) }),
    }).toString();

    const response = await getSubuserStatisticsService(queryParams);

    res.status(200).json(response);
  } catch (err) {
    handleServerError(res, err, "Failed to retrieve statistics");
  }
};

export const getMyInformation = async (
  req: Request,
  res: Response
): Promise<void> => {
  if (!API_KEY) {
    res.status(400).json({ message: "API Key is missing" });
    return;
  }

  try {
    const response = await getMyInformationService();
    res.status(200).json(response);
  } catch (err) {
    handleServerError(res, err, "Failed to fetch MyInfo");
  }
};

export const getSubUsers = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.query;

    // If no id is provided and the user is not an admin, return error
    if (!id && !req.user?.isAdmin) {
      res.status(403).json({
        message: "Forbidden. Only admins can access all sub-users.",
      });
      return;
    }

    const response = await getSubUsersService(id as string);

    const payload = Array.isArray(response?.payload) ? response?.payload : [];

    // Calculate total traffic limit
    const totalTrafficLimit = payload.reduce(
      (sum: number, user: any) => sum + (user?.traffic_limit || 0),
      0
    );

    // Calculate total used traffic
    const totalUsedTraffic = payload.reduce(
      (sum: number, user: any) => sum + (user?.used_traffic || 0),
      0
    );

    res.status(200).json({ ...response, totalTrafficLimit, totalUsedTraffic });
  } catch (err: any) {
    handleServerError(res, err, "Internal Server Error Occurred");
  }
};

export const createSubUser = async (
  req: Request,
  res: Response
): Promise<void> => {
  let { email, proxy_username, is_traffic_limited, traffic_limit } = req.body;

  if (!proxy_username) {
    res.status(400).json({ message: "Username is required" });
    return;
  }

  // ✅ Generate random password
  const proxy_password = generatePassword(12);

  // ✅ Convert allocated traffic from GB to bytes
  const allocated_traffic = gbToBytes(traffic_limit);

  const user = await User.findOne({ email: email });
  if (!user) {
    res.status(403).json({ message: "User not found" });
    return;
  }

  try {
    const subUserData = {
      proxy_username,
      proxy_password,
      is_traffic_limited: is_traffic_limited ?? false,
      traffic_limit: allocated_traffic,
    };
    const response = await createSubUserService(subUserData);

    res.status(200).json(response);
  } catch (err: any) {
    handleServerError(res, err, "Failed to create sub-user");
  }
};

export const updateSubuserPassword = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { email } = req.body;

    if (!email) {
      res.status(400).json({ message: "Email is required" });
      return;
    }

    const user = await User.findOne({ email });
    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    const subUserId = user.subUserId;
    if (!subUserId) {
      res.status(404).json({ message: "Sub-user ID not found" });
      return;
    }

    // ✅ Generate random password
    const generatedPassword = generatePassword(12);

    // Update the sub-user's traffic limit
    const updateResult = await updateSubUserService(subUserId, {
      proxy_password: generatedPassword,
    });
    if (
      !updateResult?.success ||
      Object.keys(updateResult?.errors || {}).length > 0
    ) {
      console.error("❌ Failed to update traffic limit:", updateResult?.errors);
      res.status(500).json({ message: "Failed to reset password, try again" });
      return;
    }

    res.status(200).json({
      success: true,
      message: "Password generated successfully",
    });
  } catch (error: any) {
    handleServerError(res, error, "Failed to update sub-user");
  }
};

export const updateSubUser = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { email, trafficData, updateExactLimit } = req.body;
    const sessionUser = (req as any).user;
    const adminEmail = sessionUser?.email;

    if (!email) {
      res.status(400).json({ message: "Email is required" });
      return;
    }
    if (!trafficData || isNaN(trafficData)) {
      res.status(400).json({ message: "Invalid traffic data" });
      return;
    }

    const user = await User.findOne({ email });
    if (!user) {
      res.status(403).json({ message: "User not found" });
      return;
    }

    const subUserId = user.subUserId;
    if (!subUserId) {
      res.status(404).json({ message: "Sub-user ID not found" });
      return;
    }

    // Retrieve current sub-user details
    const subUserResponse = await getSubUsersService(subUserId);
    const currentTrafficLimit = subUserResponse?.payload?.traffic_limit ?? 0;
    let usedBalance = subUserResponse?.payload?.used_traffic ?? 0;

    // console.log("Used Balance before adjustment:", usedBalance);

    // If available balance is zero or negative, reset usedBalance to 0
    const availableBalance = currentTrafficLimit - Math.max(0, usedBalance);
    if (availableBalance <= 0) {
      usedBalance = 0;
    }

    // console.log("Adjusted Used Balance:", usedBalance);

    // Convert trafficData (in GB) to bytes
    const additionalTraffic = gbToBytes(trafficData);

    // Calculate new traffic limit
    const newTrafficLimit = updateExactLimit
      ? additionalTraffic // Set exact new limit
      : currentTrafficLimit - usedBalance + additionalTraffic; // Add to remaining balance

    // Update the sub-user's traffic limit
    const updateResult = await updateSubUserService(subUserId, {
      used_traffic: 0,
      traffic_limit: newTrafficLimit,
    });

    if (
      !updateResult?.success ||
      Object.keys(updateResult?.errors || {}).length > 0
    ) {
      console.error("❌ Failed to update traffic limit:", updateResult?.errors);
      res.status(500).json({ message: "Failed to update sub-user traffic" });
      return;
    }

    if (Number(trafficData) > 0.8) {
      // Update the user record in the database
      await User.findOneAndUpdate(
        { email: email },
        {
          $inc: { paymentCount: 1 },
          $set: { balance: bytesToGB(newTrafficLimit) },
        },
        { new: true }
      );

      Transfers.create({
        fromEmail:
          adminEmail === "fluidbrakes@gmail.com" ? "Elina Sofia" : adminEmail,
        toEmail: email,
        amount: trafficData,
        reverse: false,
        type: "Internal Transfer",
        timestamp: new Date(),
      });
    }

    await User.findOneAndUpdate(
      { email: email },
      {
        $set: { balance: bytesToGB(newTrafficLimit) },
      },
      { new: true }
    );

    res.status(200).json({
      success: true,
      message: "Traffic updated successfully",
      newTrafficLimit,
    });
  } catch (error: any) {
    handleServerError(res, error, "Failed to update sub-user");
  }
};

export const deleteSubUser = async (
  req: Request,
  res: Response
): Promise<void> => {
  if (!API_KEY) {
    res.status(400).json({ message: "API Key is missing" });
    return;
  }

  const { id } = req.params;

  if (!id) {
    res.status(400).json({ message: "Sub-user ID is missing" });
    return;
  }

  try {
    await deleteSubUserByIdService(id);
  } catch (err) {
    handleServerError(res, err, "Failed to Delete sub-user");
  }
};

export const getWhitelistIps = async (
  req: Request,
  res: Response
): Promise<void> => {
  if (!API_KEY) {
    res.status(400).json({ message: "API Key is missing" });
    return;
  }

  try {
    const response = await fetch(`${baseURL}/whitelist/ips/`, {
      method: "GET",
      headers: {
        Authorization: `x-api-key ${API_KEY}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const errorData = await response.json();
      res.status(response.status).json({
        message: errorData?.detail || "Failed to fetch whitelist IPs",
      });
      return;
    }

    const data = await response.json();
    res.status(200).json(data);
  } catch (err) {
    handleServerError(res, err, "Failed to fetch whitelist IPs");
  }
};

export const getWhitelistIpById = async (
  req: Request,
  res: Response
): Promise<void> => {
  if (!API_KEY) {
    res.status(400).json({ message: "API Key is missing" });
    return;
  }

  const { id } = req.params;

  if (!id) {
    res.status(400).json({ message: "Whitelist IP ID is missing" });
    return;
  }

  try {
    const response = await fetch(`${baseURL}/whitelist/ip/${id}`, {
      method: "GET",
      headers: {
        Authorization: `x-api-key ${API_KEY}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const errorData = await response.json();
      res
        .status(response.status)
        .json({ message: errorData?.detail || "Failed to fetch whitelist IP" });
      return;
    }

    const data = await response.json();
    res.status(200).json(data);
  } catch (err) {
    handleServerError(res, err, "Failed to fetch whitelist IP");
  }
};

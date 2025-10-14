// subUserService.ts
import axios from "axios";
import dotenv from "dotenv";
import { connection } from "mongoose";

dotenv.config();

const baseURL = process.env.BASE_URL;
const API_KEY = process.env.NODEMAVEN_API_KEY;

const buildQueryParams = (params: any) => {
  return Object.keys(params)
    .filter((key) => params[key] !== undefined && params[key] !== "")
    .map((key) => `${key}=${encodeURIComponent(params[key])}`)
    .join("&");
};

if (!baseURL) {
  throw new Error("BASE_URL is not defined in the environment variables");
}

if (!API_KEY) {
  throw new Error(
    "NODEMAVEN_API_KEY is not defined in the environment variables"
  );
}

// Create an Axios instance for convenience and consistent headers.
const axiosInstance = axios.create({
  baseURL,
  headers: {
    Authorization: `x-api-key ${API_KEY}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  },
  timeout: 300000,
  family: 4,
});

// Helper function to handle API errors
const handleApiError = (error: any) => {
  if (axios.isAxiosError(error)) {
    console.error("API Request Failed:", error.response?.data || error.message);
    return {
      error: true,
      message: error.response?.data?.message || "An error occurred",
    };
  }
  console.error("Unexpected Error:", error);
  return { error: true, message: "Something went wrong. Please try again." };
};

/**
 * Create a new sub-user.
 * @param subUserData - An object containing the sub-user properties (e.g., proxy_username, proxy_password, traffic_limit, etc.)
 * @returns The created sub-user data from the API.
 */
export const createSubUserService = async (subUserData: any): Promise<any> => {
  const response = await axiosInstance.post("/sub-users/", subUserData);
  return response.data;
};

/**
 * Retrieve sub-user(s) from the API.
 * @param id - (Optional) The sub-user ID to retrieve. If omitted, all sub-users are returned.
 * @returns The sub-user data from the API.
 */
export const getSubUsersService = async (id?: string): Promise<any> => {
  try {
    const url = id ? `/sub-users?id=${id}` : "/sub-users/";
    const response = await axiosInstance.get(url);

    // Check for unexpected status codes (e.g., 500, 400)
    if (response.status >= 400) {
      console.warn("Server returned an error:", response.status);
      return { error: true, message: `Error: ${response.status}` };
    }

    return response.data;
  } catch (error) {
    return handleApiError(error);
  }
};

/**
 * Update a sub-user's details.
 * @param subUserId - The ID of the sub-user to update.
 * @param updateData - An object containing the fields to update (e.g., traffic_limit).
 * @returns The updated sub-user data from the API.
 */
export const updateSubUserService = async (
  subUserId: string,
  updateData: any
): Promise<any> => {
  const payload = { id: subUserId, ...updateData };
  const response = await axiosInstance.put("/sub-users/", payload);
  return response.data;
};

//get sub user statistics
export const getSubuserStatisticsService = async (
  queryString: string
): Promise<any> => {
  try {
    console.log(`/statistics/domains?${queryString}`);

    const response = await axiosInstance.get(
      `/statistics/domains/?${queryString}`,
      {
        timeout: 5000,
      }
    );

    // Check for unexpected status codes (e.g., 500, 400)
    if (response.status >= 400) {
      console.warn("Server returned an error:", response.status);
      return { error: true, message: `Error: ${response.status}` };
    }
    return response.data; // Fixed typo from 'Data' to 'data'
  } catch (error) {
    return handleApiError(error);
  }
};

/**
 * Delete a sub-user by ID.
 * @param subUserId - The ID of the sub-user to delete.
 */
export const deleteSubUserByIdService = async (
  subUserId: string
): Promise<void> => {
  const url = `/sub-users?id=${subUserId}`;
  await axiosInstance.delete(url);
};

export const getAllLocations = async () => {
  const response = await axiosInstance.get("/locations/all/");
  return response.data;
};

export const getCountries = async (countryName: string, limit: number) => {
  const queryParams = buildQueryParams({ name: countryName, limit });
  const response = await axiosInstance.get(
    `/locations/countries/?${queryParams}`
  );
  return response.data;
};

export const getRegionsService = async (
  countryCode: string,
  limit: any,
  connection: string
) => {
  const queryParams = buildQueryParams({
    country__code: countryCode,
    limit,
    connection_type: connection,
  });

  const response = await axiosInstance.get(
    `/locations/regions/?${queryParams}`
  );
  return response.data;
};

export const getCitiesService = async (
  countryCode: string,
  regionCode: string,
  limit: any,
  connection: string
) => {
  const queryParams = buildQueryParams({
    country__code: countryCode,
    region__code: regionCode,
    limit,
    connection_type: connection,
  });
  const response = await axiosInstance.get(`/locations/cities/?${queryParams}`);
  return response.data;
};

export const getIspsService = async (
  countryCode: string,
  regionCode: string,
  cityCode: string,
  connection: string
) => {
  const queryParams = buildQueryParams({
    country__code: countryCode,
    region__code: regionCode,
    offset: 0,
    city_code: cityCode,
    connection_type: connection,
    limit: 100,
  });
  const response = await axiosInstance.get(`/locations/isps/?${queryParams}`);

  return response?.data;
};
export const getZipCodesService = async (
  countryCode: string,
  regionCode: string,
  cityCode: string,
  connection: string
) => {
  const queryParams = buildQueryParams({
    country__code: countryCode,
    region__code: regionCode,
    offset: 0,
    city_code: cityCode,
    connection_type: connection,
    limit: 10,
  });

  const response = await axiosInstance.get(
    `/locations/zipcodes/?${queryParams}/`
  );

  return response?.data;
};

export const getStatisticsData = async () => {
  const response = await axiosInstance.get("/statistics/data/");
  return response.data;
};

export const getMyInformationService = async () => {
  const response = await axiosInstance.get("/users/me/");
  return response.data;
};

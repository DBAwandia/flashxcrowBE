import { Request, Response, NextFunction, RequestHandler } from "express";
import jwt from "jsonwebtoken";

// Define the structure of the decoded JWT token
interface DecodedToken {
  id: string;
  isAdmin: boolean;
  email: string;
}

// Extend the Request object to include the user property
export interface AuthenticatedRequest extends Request {
  user?: DecodedToken;
}

// Middleware to verify JWT token from cookies
export const authenticate: RequestHandler = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  // Check for token in cookies or Authorization header
  const token =
    req.headers.authorization?.split(" ")[1] ?? req.cookies?.authToken;

  if (!token) {
    res.status(403).json({
      redirect: "/login",
      message: "Unauthorized. No token provided.",
    });
    return;
  }

  try {
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET as string
    ) as DecodedToken;
    (req as AuthenticatedRequest).user = decoded; // Explicitly type req
    next();
  } catch (error) {
    res.status(401).json({
      redirect: "/login",
      message: "Unauthorized. Invalid or expired token.",
    });
  }
};

// Middleware to restrict access to admin and user roles
export const adminAndUserOnly: RequestHandler = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  if (!req.user) {
    res
      .status(401)
      .json({ redirect: "/login", message: "Unauthorized. Please log in." });
    return;
  }
  next();
};

// Middleware to restrict access to admin-only routes
export const adminOnly: RequestHandler = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  if (!req.user || !req.user.isAdmin) {
    res.status(403).json({
      redirect: "/login",
      message: "Forbidden. Admin access required.",
    });
    return;
  }
  next();
};

import { Request } from 'express';

export const getUserFilter = (req: Request): Record<string, any> => {
  if (!req.user) {
    return {};
  }
  // Filter by organization for multi-tenancy
  if (req.user.organization) {
    return { organization: req.user.organization };
  }
  // Fallback to user-based filtering if no organization
  return req.user.role === 'admin' ? {} : { user: req.user._id };
};

export const requireUserOwnership = (req: Request, resourceUserId: any): boolean => {
  if (!req.user) {
    return false;
  }
  if (req.user.role === 'admin') {
    return true;
  }
  return req.user._id.toString() === resourceUserId?.toString();
};


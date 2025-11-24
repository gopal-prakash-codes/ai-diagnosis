import { Request, Response, NextFunction } from 'express';
import { User } from '../models/User';
import { Organization } from '../models/Organization';
import { generateToken, JWTPayload } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';

export const register = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { email, password, firstName, lastName } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      res.status(400).json({
        success: false,
        message: 'User with this email already exists'
      });
      return;
    }

    // Create new user as admin
    const user = new User({
      email,
      password,
      firstName,
      lastName,
      role: 'admin'
    });

    await user.save();

    // Create organization for the admin
    const organization = new Organization({
      name: `${firstName} ${lastName}'s Organization`,
      admin: user._id,
      members: []
    });

    await organization.save();

    // Update user with organization reference
    user.organization = organization._id;
    await user.save();

    // Generate JWT token
    const payload: JWTPayload = {
      userId: user._id.toString(),
      email: user.email,
      role: user.role,
      organizationId: organization._id.toString()
    };

    const token = generateToken(payload);

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      data: {
        user: {
          id: user._id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          organization: organization._id
        },
        token
      }
    });
  } catch (error) {
    next(error);
  }
};

export const login = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { email, password } = req.body;

    // Find user by email
    const user = await User.findOne({ email });
    if (!user) {
      res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
      return;
    }

    // Check if user is active
    if (!user.isActive) {
      res.status(401).json({
        success: false,
        message: 'Account is deactivated'
      });
      return;
    }

    // Verify password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
      return;
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    // Populate organization if exists
    await user.populate('organization');

    // Generate JWT token
    const payload: JWTPayload = {
      userId: user._id.toString(),
      email: user.email,
      role: user.role,
      organizationId: user.organization ? (user.organization as any)._id.toString() : undefined
    };

    const token = generateToken(payload);

    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        user: {
          id: user._id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          organization: user.organization,
          lastLogin: user.lastLogin
        },
        token
      }
    });
  } catch (error) {
    next(error);
  }
};

export const getProfile = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
      return;
    }

    // Populate organization and get all members
    const user = await User.findById(req.user._id)
      .populate('organization')
      .select('-password');

    if (!user || !user.organization) {
      res.status(404).json({
        success: false,
        message: 'User or organization not found'
      });
      return;
    }

    const organization = await Organization.findById(user.organization)
      .populate('admin', 'firstName lastName email role')
      .populate('members', 'firstName lastName email role isActive lastLogin');

    // Get all users in the organization (admin + members)
    const allMembers = organization ? [
      organization.admin,
      ...organization.members
    ].filter(Boolean) : [];

    res.status(200).json({
      success: true,
      data: {
        user: {
          id: user._id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          organization: organization
        },
        teamMembers: allMembers
      }
    });
  } catch (error) {
    next(error);
  }
};

export const logout = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    res.status(200).json({
      success: true,
      message: 'Logout successful'
    });
  } catch (error) {
    next(error);
  }
};

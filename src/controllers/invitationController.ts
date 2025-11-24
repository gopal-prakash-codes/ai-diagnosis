import { Request, Response, NextFunction } from 'express';
import { Invitation } from '../models/Invitation';
import { Organization } from '../models/Organization';
import { User } from '../models/User';
import nodemailer from 'nodemailer';
import crypto from 'crypto';

// Email transporter setup
const createTransporter = () => {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    throw new Error('SMTP configuration is missing. Please set SMTP_USER and SMTP_PASS in your .env file.');
  }

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false, // true for 465, false for other ports
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    },
    tls: {
      // Do not fail on invalid certs
      rejectUnauthorized: false
    }
  });
};

export const inviteMember = async (
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

    const { email } = req.body;

    if (!email) {
      res.status(400).json({
        success: false,
        message: 'Email is required'
      });
      return;
    }

    // Check if user is admin
    if (req.user.role !== 'admin') {
      res.status(403).json({
        success: false,
        message: 'Only admins can invite members'
      });
      return;
    }

    // Check if user has organization
    if (!req.user.organization) {
      res.status(400).json({
        success: false,
        message: 'User does not belong to an organization'
      });
      return;
    }

    // Check if email already exists as a user
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      // Check if user already belongs to this organization
      if (existingUser.organization?.toString() === req.user.organization.toString()) {
        res.status(400).json({
          success: false,
          message: 'User is already a member of this organization'
        });
        return;
      }
    }

    // Check if there's a pending invitation for this email and organization
    const existingInvitation = await Invitation.findOne({
      email: email.toLowerCase(),
      organization: req.user.organization,
      status: 'pending'
    });

    if (existingInvitation) {
      res.status(400).json({
        success: false,
        message: 'An invitation has already been sent to this email'
      });
      return;
    }

    // Generate invitation token
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days expiry

    // Send invitation email first (before saving to DB)
    try {
      const transporter = createTransporter();
      const invitationLink = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/accept-invitation/${token}`;
      
      await transporter.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: email,
        subject: 'Invitation to join organization',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>You've been invited!</h2>
            <p>You have been invited to join an organization on the AI Diagnosis platform.</p>
            <p>Click the link below to accept the invitation:</p>
            <a href="${invitationLink}" style="display: inline-block; padding: 10px 20px; background-color: #4F46E5; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0;">
              Accept Invitation
            </a>
            <p>This invitation will expire in 7 days.</p>
            <p>If you didn't request this invitation, you can safely ignore this email.</p>
          </div>
        `
      });
    } catch (emailError) {
      console.error('Error sending invitation email:', emailError);
      
      // Return error response - don't save invitation if email fails
      const errorMessage = emailError instanceof Error ? emailError.message : 'Unknown error';
      
      // Check if it's an authentication error
      if (errorMessage.includes('BadCredentials') || errorMessage.includes('Invalid login')) {
        res.status(500).json({
          success: false,
          message: 'Failed to send invitation email: Invalid SMTP credentials. Please check your email configuration.',
          error: 'SMTP authentication failed. Make sure you are using an App Password (not your regular password) for Gmail.',
          details: 'Check your .env file: SMTP_USER and SMTP_PASS must be correct. For Gmail, you need to generate an App Password at https://myaccount.google.com/apppasswords'
        });
        return;
      }
      
      res.status(500).json({
        success: false,
        message: 'Failed to send invitation email. Please check your SMTP configuration.',
        error: errorMessage
      });
      return;
    }

    // Only save invitation if email was sent successfully
    const invitation = new Invitation({
      email: email.toLowerCase(),
      organization: req.user.organization,
      invitedBy: req.user._id,
      token,
      status: 'pending',
      expiresAt
    });

    await invitation.save();

    res.status(201).json({
      success: true,
      message: 'Invitation sent successfully',
      data: {
        invitation: {
          id: invitation._id,
          email: invitation.email,
          expiresAt: invitation.expiresAt
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

export const acceptInvitation = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { token, password, firstName, lastName } = req.body;

    if (!token) {
      res.status(400).json({
        success: false,
        message: 'Invitation token is required'
      });
      return;
    }

    // Find invitation
    const invitation = await Invitation.findOne({ token, status: 'pending' })
      .populate('organization');

    if (!invitation) {
      res.status(404).json({
        success: false,
        message: 'Invalid or expired invitation'
      });
      return;
    }

    // Check if invitation is expired
    if (new Date() > invitation.expiresAt) {
      invitation.status = 'expired';
      await invitation.save();
      res.status(400).json({
        success: false,
        message: 'Invitation has expired'
      });
      return;
    }

    // Check if user already exists
    let user = await User.findOne({ email: invitation.email });

    if (user) {
      // User exists, add them to the organization
      if (user.organization?.toString() === invitation.organization._id.toString()) {
        res.status(400).json({
          success: false,
          message: 'You are already a member of this organization'
        });
        return;
      }

      user.organization = invitation.organization._id;
      await user.save();

      // Add user to organization members
      const organization = await Organization.findById(invitation.organization._id);
      if (organization && !organization.members.includes(user._id)) {
        organization.members.push(user._id);
        await organization.save();
      }
    } else {
      // Create new user
      if (!password || !firstName || !lastName) {
        res.status(400).json({
          success: false,
          message: 'Password, first name, and last name are required for new users'
        });
        return;
      }

      user = new User({
        email: invitation.email,
        password,
        firstName,
        lastName,
        role: 'user',
        organization: invitation.organization._id
      });

      await user.save();

      // Add user to organization members
      const organization = await Organization.findById(invitation.organization._id);
      if (organization) {
        organization.members.push(user._id);
        await organization.save();
      }
    }

    // Mark invitation as accepted
    invitation.status = 'accepted';
    await invitation.save();

    res.status(200).json({
      success: true,
      message: 'Invitation accepted successfully',
      data: {
        user: {
          id: user._id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

export const getInvitationByToken = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { token } = req.params;

    const invitation = await Invitation.findOne({ token, status: 'pending' })
      .populate('organization', 'name')
      .populate('invitedBy', 'firstName lastName email');

    if (!invitation) {
      res.status(404).json({
        success: false,
        message: 'Invalid or expired invitation'
      });
      return;
    }

    // Check if invitation is expired
    if (new Date() > invitation.expiresAt) {
      invitation.status = 'expired';
      await invitation.save();
      res.status(400).json({
        success: false,
        message: 'Invitation has expired'
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: {
        invitation: {
          email: invitation.email,
          organization: invitation.organization,
          invitedBy: invitation.invitedBy,
          expiresAt: invitation.expiresAt
        }
      }
    });
  } catch (error) {
    next(error);
  }
};


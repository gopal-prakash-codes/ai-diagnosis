import { Router } from 'express';
import { inviteMember, acceptInvitation, getInvitationByToken } from '../controllers/invitationController';
import { authenticateToken } from '../middleware/auth';

const router = Router();

// Protected routes (admin only)
router.post('/invite', authenticateToken, inviteMember);

// Public routes
router.get('/token/:token', getInvitationByToken);
router.post('/accept', acceptInvitation);

export default router;


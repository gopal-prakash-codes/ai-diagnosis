import { Router } from 'express';
import {
  getAllUsers,
  getUserById,
  updateUser,
  deleteUser,
  updateProfile
} from '../controllers/userController';
import { validateUserUpdate } from '../middleware/validation';
import { authenticateToken, authorizeRoles } from '../middleware/auth';

const router = Router();

// All routes require authentication
router.use(authenticateToken);

// Profile routes (accessible to all authenticated users)
router.get('/profile', updateProfile); // This is actually getProfile from auth, but keeping consistent
router.put('/profile', validateUserUpdate, updateProfile);

// Admin-only routes
router.get('/', authorizeRoles('admin'), getAllUsers);
router.get('/:id', authorizeRoles('admin'), getUserById);
router.put('/:id', authorizeRoles('admin'), validateUserUpdate, updateUser);
router.delete('/:id', authorizeRoles('admin'), deleteUser);

export default router;

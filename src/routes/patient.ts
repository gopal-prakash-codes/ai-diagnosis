import { Router } from 'express';
import {
  createPatient,
  getAllPatients,
  getPatientById,
  updatePatient,
  deletePatient,
  getPatientStats
} from '../controllers/patientController';
import { validatePatient, validatePatientUpdate } from '../middleware/validation';
import { authenticateToken, authorizeRoles } from '../middleware/auth';

const router = Router();

// All routes require authentication
router.use(authenticateToken);

// Create patient
router.post('/', validatePatient, createPatient);

// Get all patients with search and pagination
router.get('/', getAllPatients);

// Get patient statistics
router.get('/stats', getPatientStats);

// Get patient by ID
router.get('/:id', getPatientById);

// Update patient
router.put('/:id', validatePatientUpdate, updatePatient);

// Delete patient
router.delete('/:id', deletePatient);

export default router;

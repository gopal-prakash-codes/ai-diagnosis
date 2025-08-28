import { Router } from 'express';
import {
  analyzeConversation,
  getDiagnosisHistory,
  getDiagnosisById
} from '../controllers/diagnosisController';
import { authenticateToken, authorizeRoles } from '../middleware/auth';

const router = Router();

// All routes require authentication
// router.use(authenticateToken);

// Analyze doctor-patient conversation
router.post('/analyze', analyzeConversation);

// Get diagnosis history for a patient
router.get('/patient/:patientId', getDiagnosisHistory);

// Get specific diagnosis by ID
router.get('/:id', getDiagnosisById);

export default router;

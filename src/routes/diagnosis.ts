import { Router } from 'express';
import {
  analyzeConversation,
  getDiagnosisHistory,
  getDiagnosisById,
  transcribe
} from '../controllers/diagnosisController';
import { upload } from '../middleware/multerSetup';
import { authenticateToken } from '../middleware/auth';

const router = Router();

// All routes require authentication
router.use(authenticateToken);

// Analyze doctor-patient conversation
router.post('/analyze', analyzeConversation);

// Get diagnosis history for a patient
router.get('/patient/:patientId', getDiagnosisHistory);

// Get specific diagnosis by ID
router.get('/:id', getDiagnosisById);

// Transcribe audio chunks for live transcription
router.post('/transcribe', upload.single("file"), transcribe);

export default router;

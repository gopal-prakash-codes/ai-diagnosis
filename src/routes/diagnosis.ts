import { Router } from 'express';
import {
  analyzeConversation,
  getDiagnosisHistory,
  getDiagnosisById,
  transcribe,
  transcribeWithSpeakers
} from '../controllers/diagnosisController';
import { upload } from '../middleware/multerSetup';
import { authenticateToken } from '../middleware/auth';

const router = Router();
router.use(authenticateToken);
router.post('/analyze', analyzeConversation);
router.get('/patient/:patientId', getDiagnosisHistory);
router.get('/:id', getDiagnosisById);
router.post('/transcribe', upload.single("file"), transcribe);
router.post('/transcribe-speakers', upload.single("file"), transcribeWithSpeakers);

export default router;

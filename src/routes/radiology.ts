import express from 'express';
import { body, param, query } from 'express-validator';
import {
  createRadiologyReport,
  getRadiologyReport,
  uploadScanFiles,
  startAnalysis,
  updateAnalysisResult,
  updateReportWithAnalysis,
  getAnalysisResult,
  generateDownloadUrl,
  getPatientRadiologyReports,
  deleteRadiologyReport,
  deleteScanRecord,
  uploadMiddleware
} from '../controllers/radiologyController';
import { authenticateToken } from '../middleware/auth';

const router = express.Router();
router.use(authenticateToken);

/**
 * @route POST /api/radiology/reports
 * @desc Create a new radiology report
 * @access Private
 */
router.post('/reports', [
  body('patientId')
    .notEmpty()
    .withMessage('Patient ID is required')
    .isMongoId()
    .withMessage('Invalid patient ID format'),
  body('reportType')
    .optional()
    .isIn(['Report', 'MRI', 'CT-SCAN', 'X-RAY'])
    .withMessage('Report type must be Report, MRI, CT-SCAN, or X-RAY'),
  body('doctor')
    .optional()
    .isLength({ max: 100 })
    .withMessage('Doctor name must be less than 100 characters'),
  body('clinicName')
    .optional()
    .isLength({ max: 200 })
    .withMessage('Clinic name must be less than 200 characters'),
  body('clinicAddress')
    .optional()
    .isLength({ max: 500 })
    .withMessage('Clinic address must be less than 500 characters'),
  body('symptoms')
    .optional()
    .isArray()
    .withMessage('Symptoms must be an array'),
  body('symptoms.*')
    .optional()
    .isLength({ max: 200 })
    .withMessage('Each symptom must be less than 200 characters'),
  body('diagnosis')
    .optional()
    .isLength({ max: 1000 })
    .withMessage('Diagnosis must be less than 1000 characters'),
  body('confidence')
    .optional()
    .isFloat({ min: 0, max: 100 })
    .withMessage('Confidence must be between 0 and 100'),
  body('treatment')
    .optional()
    .isLength({ max: 2000 })
    .withMessage('Treatment must be less than 2000 characters')
], createRadiologyReport);

/**
 * @route GET /api/radiology/reports/:reportId
 * @desc Get radiology report by ID
 * @access Private
 */
router.get('/reports/:reportId', [
  param('reportId')
    .notEmpty()
    .withMessage('Report ID is required')
    .custom((value) => {
      const customReportIdRegex = /^RPT-\d+-[a-z0-9]+$/;
      const mongoObjectIdRegex = /^[0-9a-fA-F]{24}$/;
      
      if (customReportIdRegex.test(value) || mongoObjectIdRegex.test(value)) {
        return true;
      }
      
      throw new Error('Invalid report ID format. Must be either custom report ID (RPT-xxx) or MongoDB ObjectId');
    })
], getRadiologyReport);

/**
 * @route POST /api/radiology/reports/:reportId/upload
 * @desc Upload scan files for a report
 * @access Private
 */
router.post('/reports/:reportId/upload', [
  param('reportId')
    .notEmpty()
    .withMessage('Report ID is required')
    .custom((value) => {
      const customReportIdRegex = /^RPT-\d+-[a-z0-9]+$/;
      const mongoObjectIdRegex = /^[0-9a-fA-F]{24}$/;
      
      if (customReportIdRegex.test(value) || mongoObjectIdRegex.test(value)) {
        return true;
      }
      
      throw new Error('Invalid report ID format. Must be either custom report ID (RPT-xxx) or MongoDB ObjectId');
    }),
  body('scanType')
    .notEmpty()
    .withMessage('Scan type is required')
    .isIn(['Report', 'MRI', 'CT-SCAN', 'X-RAY'])
    .withMessage('Scan type must be Report, MRI, CT-SCAN, or X-RAY')
], uploadMiddleware, uploadScanFiles);

/**
 * @route POST /api/radiology/scans/:scanRecordId/analyze
 * @desc Start analysis for a scan record
 * @access Private
 */
router.post('/scans/:scanRecordId/analyze', [
  param('scanRecordId')
    .notEmpty()
    .withMessage('Scan record ID is required')
    .isMongoId()
    .withMessage('Invalid scan record ID format'),
  body('analysisType')
    .optional()
    .isIn(['2D', '3D'])
    .withMessage('Analysis type must be 2D or 3D')
], startAnalysis);

/**
 * @route PUT /api/radiology/analysis/:analysisId
 * @desc Update analysis result
 * @access Private
 */
router.put('/analysis/:analysisId', [
  param('analysisId')
    .notEmpty()
    .withMessage('Analysis ID is required')
    .isMongoId()
    .withMessage('Invalid analysis ID format'),
  body('status')
    .optional()
    .isIn(['processing', 'completed', 'failed', 'timeout'])
    .withMessage('Status must be processing, completed, failed, or timeout'),
  body('urgency')
    .optional()
    .isIn(['Normal', 'Priority', 'Emergency'])
    .withMessage('Urgency must be Normal, Priority, or Emergency'),
  body('modality')
    .optional()
    .isLength({ max: 100 })
    .withMessage('Modality must be less than 100 characters'),
  body('findings')
    .optional()
    .isLength({ max: 5000 })
    .withMessage('Findings must be less than 5000 characters'),
  body('diagnosis')
    .optional()
    .isLength({ max: 2000 })
    .withMessage('Diagnosis must be less than 2000 characters'),
  body('treatmentPlan')
    .optional()
    .isLength({ max: 3000 })
    .withMessage('Treatment plan must be less than 3000 characters'),
  body('confidenceSummary')
    .optional()
    .isLength({ max: 1000 })
    .withMessage('Confidence summary must be less than 1000 characters'),
  body('limitations')
    .optional()
    .isLength({ max: 1000 })
    .withMessage('Limitations must be less than 1000 characters'),
  body('errorMessage')
    .optional()
    .isLength({ max: 1000 })
    .withMessage('Error message must be less than 1000 characters')
], updateAnalysisResult);

/**
 * @route PUT /api/radiology/reports/:reportId/update-analysis
 * @desc Update radiology report with analysis results
 * @access Private
 */
router.put('/reports/:reportId/update-analysis', [
  param('reportId')
    .notEmpty()
    .withMessage('Report ID is required')
    .isMongoId()
    .withMessage('Invalid report ID format'),
  body('diagnosis')
    .optional()
    .isLength({ max: 2000 })
    .withMessage('Diagnosis must be less than 2000 characters'),
  body('confidence')
    .optional()
    .isFloat({ min: 0, max: 100 })
    .withMessage('Confidence must be between 0 and 100'),
  body('treatment')
    .optional()
    .isLength({ max: 3000 })
    .withMessage('Treatment must be less than 3000 characters'),
  body('symptoms')
    .optional()
    .isArray()
    .withMessage('Symptoms must be an array'),
  body('symptoms.*')
    .optional()
    .isLength({ max: 200 })
    .withMessage('Each symptom must be less than 200 characters')
], updateReportWithAnalysis);

/**
 * @route GET /api/radiology/analysis/:analysisId
 * @desc Get analysis result
 * @access Private
 */
router.get('/analysis/:analysisId', [
  param('analysisId')
    .notEmpty()
    .withMessage('Analysis ID is required')
    .isMongoId()
    .withMessage('Invalid analysis ID format')
], getAnalysisResult);

/**
 * @route GET /api/radiology/scans/:scanRecordId/download
 * @desc Generate download URL for a scan file
 * @access Private
 */
router.get('/scans/:scanRecordId/download', [
  param('scanRecordId')
    .notEmpty()
    .withMessage('Scan record ID is required')
    .isMongoId()
    .withMessage('Invalid scan record ID format'),
  query('fileType')
    .optional()
    .isIn(['original', 'analyzed', 'report'])
    .withMessage('File type must be original, analyzed, or report')
], generateDownloadUrl);

/**
 * @route DELETE /api/radiology/scans/:scanRecordId
 * @desc Delete a scan record and associated files
 * @access Private
 */
router.delete('/scans/:scanRecordId', [
  param('scanRecordId')
    .notEmpty()
    .withMessage('Scan record ID is required')
    .isMongoId()
    .withMessage('Invalid scan record ID format')
], deleteScanRecord);

/**
 * @route DELETE /api/radiology/reports/:reportId
 * @desc Delete a radiology report and associated files
 * @access Private
 */
router.delete('/reports/:reportId', [
  param('reportId')
    .notEmpty()
    .withMessage('Report ID is required')
], deleteRadiologyReport);

/**
 * @route GET /api/radiology/patients/:patientId/reports
 * @desc Get all radiology reports for a patient
 * @access Private
 */
router.get('/patients/:patientId/reports', [
  param('patientId')
    .notEmpty()
    .withMessage('Patient ID is required')
    .isMongoId()
    .withMessage('Invalid patient ID format'),
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  query('status')
    .optional()
    .isIn(['draft', 'in_progress', 'completed', 'archived'])
    .withMessage('Status must be draft, in_progress, completed, or archived')
], getPatientRadiologyReports);

export default router;

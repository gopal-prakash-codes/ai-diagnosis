import { Request, Response } from 'express';
import { RadiologyReport } from '../models/RadiologyReport';
import { ScanRecord } from '../models/ScanRecord';
import { AnalysisResult } from '../models/AnalysisResult';
import { Patient } from '../models/Patient';
import WasabiStorageService from '../services/wasabiStorage';
import AnalysisIntegrationService from '../services/analysisIntegration';
import multer from 'multer';
import { validationResult } from 'express-validator';
import { getUserFilter } from '../utils/userFilter';

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 1024 * 1024 * 1024, 
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      'image/jpeg',
      'image/jpg', 
      'image/png',
      'application/zip',
      'application/x-zip-compressed'
    ];
    
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPG, PNG, and ZIP files are allowed.'));
    }
  }
});

export const uploadMiddleware = upload.fields([
  { name: 'image', maxCount: 1 },
  { name: 'zipFile', maxCount: 1 }
]);

/**
 * Create a new radiology report
 */
export const createRadiologyReport = async (req: Request, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({
        success: false,
        message: 'Validation errors',
        errors: errors.array()
      });
      return;
    }

    const {
      patientId,
      reportType,
      symptoms,
      diagnosis,
      confidence,
      treatment
    } = req.body;

    const userFilter = getUserFilter(req);
    const patient = await Patient.findOne({ _id: patientId, ...userFilter });
    if (!patient) {
      res.status(404).json({
        success: false,
        message: 'Patient not found'
      });
      return;
    }

    const reportId = `RPT-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    if (!req.user!.organization) {
      res.status(400).json({
        success: false,
        message: 'User does not belong to an organization'
      });
      return;
    }

    const report = new RadiologyReport({
      user: req.user!._id,
      organization: req.user!.organization,
      patient: patientId,
      reportId,
      reportType: reportType || 'Report',
      symptoms: Array.isArray(symptoms) ? symptoms : (symptoms ? [symptoms] : ['Pending Analysis']),
      diagnosis: diagnosis || 'Pending Analysis - Upload and analyze medical images to generate diagnosis',
      confidence: confidence || 0,
      treatment: treatment || 'Treatment plan will be generated after image analysis',
      status: 'draft'
    });

    await report.save();

    res.status(201).json({
      success: true,
      message: 'Radiology report created successfully',
      data: report
    });

  } catch (error) {
    console.error('Create radiology report error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create radiology report',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

/**
 * Get radiology report by ID
 */
export const getRadiologyReport = async (req: Request, res: Response): Promise<void> => {
  try {
    const { reportId } = req.params;
    const isObjectId = /^[0-9a-fA-F]{24}$/.test(reportId);
    const userFilter = getUserFilter(req);
    
    let report;
    if (isObjectId) {
      report = await RadiologyReport.findOne({ _id: reportId, ...userFilter })
        .populate('patient', 'name age gender');
    } else {
      report = await RadiologyReport.findOne({ reportId, ...userFilter })
        .populate('patient', 'name age gender');
    }

    if (!report) {
      res.status(404).json({
        success: false,
        message: 'Radiology report not found'
      });
      return;
    }

    const scanRecords = await ScanRecord.find({ report: report._id })
      .populate('report', 'reportId reportType')
      .lean();

    const scanRecordIds = scanRecords.map(scan => scan._id);
    const analysisResults = await AnalysisResult.find({ 
      scanRecord: { $in: scanRecordIds } 
    }).lean();

    const analysisResultsMap = new Map(
      analysisResults.map(result => [result.scanRecord.toString(), result])
    );

    const scanRecordsWithResults = scanRecords.map(scan => ({
      ...scan,
      analysisResult: analysisResultsMap.get(scan._id.toString()) || null
    }));

    res.json({
      success: true,
      data: {
        report,
        scanRecords: scanRecordsWithResults
      }
    });

  } catch (error) {
    console.error('Get radiology report error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get radiology report',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

/**
 * Upload and process scan files
 */
export const uploadScanFiles = async (req: Request, res: Response): Promise<void> => {
  const startTime = Date.now();
  try {
    console.log(`📤 Upload request received for report: ${req.params.reportId}`);
    const { reportId } = req.params;
    const { scanType } = req.body;

    if (!scanType) {
      res.status(400).json({
        success: false,
        message: 'Scan type is required'
      });
      return;
    }

    const isObjectId = /^[0-9a-fA-F]{24}$/.test(reportId);
    const userFilter = getUserFilter(req);
    
    let report;
    if (isObjectId) {
      report = await RadiologyReport.findOne({ _id: reportId, ...userFilter });
    } else {
      report = await RadiologyReport.findOne({ reportId, ...userFilter });
    }
    
    if (!report) {
      res.status(404).json({
        success: false,
        message: 'Radiology report not found'
      });
      return;
    }

    const files = req.files as { [fieldname: string]: Express.Multer.File[] };
    const uploadResults = [];

    // Process image file (2D analysis) - legacy support, but should be wrapped in ZIP now
    if (files.image && files.image[0]) {
      const imageFile = files.image[0];
      
      try {
        const wasabiStartTime = Date.now();
        const uploadResult = await WasabiStorageService.uploadImage(
          imageFile.buffer,
          imageFile.originalname,
          {
            'reportid': reportId.replace(/[^\w]/g, ''),
            'scantype': scanType.replace(/[^\w]/g, ''),
            'patientid': report.patient.toString().replace(/[^\w]/g, '')
          }
        );
        const wasabiTime = Date.now();
        console.log(`⏱️ Wasabi upload: ${((wasabiTime - wasabiStartTime) / 1000).toFixed(2)}s`);

        const scanRecordStartTime = Date.now();
        const scanRecord = new ScanRecord({
          report: report._id,
          scanType,
          fileName: uploadResult.key.split('/').pop(),
          originalFileName: imageFile.originalname,
          fileType: '2D',
          fileSize: imageFile.size,
          mimeType: imageFile.mimetype,
          originalFileUrl: uploadResult.url,
          originalFileKey: uploadResult.key,
          analysisStatus: 'pending'
        });

        await scanRecord.save();
        const scanRecordTime = Date.now();
        console.log(`⏱️ ScanRecord save: ${((scanRecordTime - scanRecordStartTime) / 1000).toFixed(2)}s`);

        uploadResults.push({
          type: '2D',
          scanRecord,
          uploadResult
        });

      } catch (error) {
        console.error('Image upload error:', error);
        res.status(500).json({
          success: false,
          message: 'Failed to upload image file',
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        return;
      }
    }

    // Process ZIP file (3D analysis - MRI, CT-SCAN, X-RAY)
    if (files.zipFile && files.zipFile[0]) {
      const zipFile = files.zipFile[0];
      
      try {
        console.log(`📦 Starting ZIP upload: ${zipFile.originalname} (${(zipFile.size / (1024 * 1024)).toFixed(2)} MB)`);
        
        // Upload to Wasabi
        const uploadResult = await WasabiStorageService.uploadZipFile(
          zipFile.buffer,
          zipFile.originalname,
          {
            'reportid': reportId.replace(/[^\w]/g, ''),
            'scantype': scanType.replace(/[^\w]/g, ''),
            'patientid': report.patient.toString().replace(/[^\w]/g, '')
          }
        );

        console.log(`✅ ZIP uploaded to Wasabi: ${uploadResult.key}`);

        // Create scan record
        const scanRecord = new ScanRecord({
          report: report._id,
          scanType,
          fileName: uploadResult.key.split('/').pop(),
          originalFileName: zipFile.originalname,
          fileType: '3D',
          fileSize: zipFile.size,
          mimeType: zipFile.mimetype,
          originalFileUrl: uploadResult.url,
          originalFileKey: uploadResult.key,
          analysisStatus: 'pending'
        });

        await scanRecord.save();
        console.log(`✅ Scan record created: ${scanRecord._id}`);

        uploadResults.push({
          type: '3D',
          scanRecord,
          uploadResult
        });

      } catch (error) {
        console.error('❌ ZIP upload error:', error);
        res.status(500).json({
          success: false,
          message: 'Failed to upload ZIP file',
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        return;
      }
    }

    if (uploadResults.length === 0) {
      res.status(400).json({
        success: false,
        message: 'No valid files provided'
      });
      return;
    }

    const reportUpdateStartTime = Date.now();
    report.status = 'in_progress';
    await report.save();
    const reportUpdateTime = Date.now();
    console.log(`⏱️ Report save: ${((reportUpdateTime - reportUpdateStartTime) / 1000).toFixed(2)}s`);

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`✅ Upload complete in ${totalTime}s. Sending response with ${uploadResults.length} file(s)`);

    // Ensure response is sent
    if (!res.headersSent) {
      res.json({
        success: true,
        message: 'Files uploaded successfully',
        data: uploadResults
      });
      console.log(`✅ Response sent successfully`);
    } else {
      console.warn('⚠️ Response already sent, cannot send upload success response');
    }

  } catch (error) {
    console.error('❌ Upload scan files error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: 'Failed to upload scan files',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    } else {
      console.error('⚠️ Response already sent, cannot send error response');
    }
  }
};

/**
 * Start analysis for a scan record
 */
export const startAnalysis = async (req: Request, res: Response): Promise<void> => {
  try {
    const { scanRecordId } = req.params;
    const { analysisType } = req.body;
    const userFilter = getUserFilter(req);

    const scanRecord = await ScanRecord.findById(scanRecordId)
      .populate({
        path: 'report',
        match: userFilter
      });
    
    if (!scanRecord || !scanRecord.report) {
      res.status(404).json({
        success: false,
        message: 'Scan record not found'
      });
      return;
    }

    if (scanRecord.analysisStatus !== 'pending') {
      res.status(400).json({
        success: false,
        message: 'Analysis already started or completed'
      });
      return;
    }

    try {
      // Start the appropriate analysis based on file type
      if (scanRecord.fileType === '2D') {
        // Start 2D analysis (async - will update database when complete)
        AnalysisIntegrationService.analyze2DImage(scanRecord._id.toString())
          .catch(error => {
            console.error(`2D Analysis failed for scan ${scanRecord._id}:`, error);
          });

        res.json({
          success: true,
          message: '2D Analysis started successfully',
          data: {
            scanRecord,
            analysisType: '2D',
            status: 'processing'
          }
        });

      } else if (scanRecord.fileType === '3D') {
        // Start 3D analysis and get job ID
        const jobId = await AnalysisIntegrationService.start3DAnalysis(scanRecord._id.toString());

        res.json({
          success: true,
          message: '3D Analysis started successfully',
          data: {
            scanRecord,
            analysisType: '3D',
            jobId: jobId,
            status: 'processing'
          }
        });

      } else {
        res.status(400).json({
          success: false,
          message: 'Unsupported file type for analysis'
        });
        return;
      }

    } catch (error) {
      console.error('Analysis start error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      try {
        await ScanRecord.findByIdAndUpdate(scanRecordId, {
          analysisStatus: 'failed',
          analysisCompletedAt: new Date()
        });
      } catch (updateError) {
        console.error('Failed to update scan record status on error:', updateError);
      }
      
      let userMessage = 'Failed to start analysis';
      if (errorMessage.includes('unavailable') || errorMessage.includes('ECONNREFUSED')) {
        userMessage = 'Analysis service is currently unavailable. Please try again later or contact support.';
      } else if (errorMessage.includes('Cannot resolve hostname')) {
        userMessage = 'Analysis service configuration error. Please contact support.';
      } else if (errorMessage.includes('timeout')) {
        userMessage = 'Analysis service request timed out. Please try again.';
      }
      
      res.status(500).json({
        success: false,
        message: userMessage,
        error: errorMessage
      });
      return;
    }

  } catch (error) {
    console.error('Start analysis error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to start analysis',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

/**
 * Update analysis result
 */
/**
 * Update radiology report with analysis results
 */
export const updateReportWithAnalysis = async (req: Request, res: Response): Promise<void> => {
  try {
    const { reportId } = req.params;
    const { diagnosis, confidence, treatment, symptoms, urgency } = req.body;
    const userFilter = getUserFilter(req);

    const report = await RadiologyReport.findOne({ _id: reportId, ...userFilter });
    if (!report) {
      res.status(404).json({
        success: false,
        message: 'Radiology report not found'
      });
      return;
    }

    // Update report with analysis results
    if (diagnosis) report.diagnosis = diagnosis;
    if (confidence !== undefined) report.confidence = confidence;
    if (treatment) report.treatment = treatment;
    if (symptoms && Array.isArray(symptoms)) report.symptoms = symptoms;
    
    // Update status to indicate analysis is complete
    report.status = 'completed';

    await report.save();

    res.json({
      success: true,
      message: 'Report updated with analysis results',
      data: report
    });

  } catch (error) {
    console.error('Update report with analysis error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update report with analysis results',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

export const updateAnalysisResult = async (req: Request, res: Response): Promise<void> => {
  try {
    const { analysisId } = req.params;
    const {
      status,
      jobId,
      modality,
      urgency,
      findings,
      diagnosis,
      treatmentPlan,
      confidenceSummary,
      limitations,
      rawData,
      debugInfo,
      errorMessage
    } = req.body;
    const userFilter = getUserFilter(req);

    const analysisResult = await AnalysisResult.findById(analysisId)
      .populate({
        path: 'scanRecord',
        populate: {
          path: 'report',
          match: userFilter
        }
      });
    
    if (!analysisResult || !analysisResult.scanRecord || 
        !(analysisResult.scanRecord as any).report) {
      res.status(404).json({
        success: false,
        message: 'Analysis result not found'
      });
      return;
    }

    // Update fields
    if (status) analysisResult.analysisStatus = status;
    if (jobId) analysisResult.jobId = jobId;
    if (modality) analysisResult.modality = modality;
    if (urgency) analysisResult.urgency = urgency;
    if (findings) analysisResult.findings = findings;
    if (diagnosis) analysisResult.diagnosis = diagnosis;
    if (treatmentPlan) analysisResult.treatmentPlan = treatmentPlan;
    if (confidenceSummary) analysisResult.confidenceSummary = confidenceSummary;
    if (limitations) analysisResult.limitations = limitations;
    if (rawData) analysisResult.rawData = rawData;
    if (debugInfo) analysisResult.debugInfo = debugInfo;
    if (errorMessage) analysisResult.errorMessage = errorMessage;

    if (status === 'completed' || status === 'failed') {
      analysisResult.analysisCompletedAt = new Date();
      
      // Update corresponding scan record
      const scanRecord = await ScanRecord.findById(analysisResult.scanRecord);
      if (scanRecord) {
        scanRecord.analysisStatus = status;
        scanRecord.analysisCompletedAt = new Date();
        await scanRecord.save();
      }
    }

    await analysisResult.save();

    res.json({
      success: true,
      message: 'Analysis result updated successfully',
      data: analysisResult
    });

  } catch (error) {
    console.error('Update analysis result error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update analysis result',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

/**
 * Get analysis result
 */
export const getAnalysisResult = async (req: Request, res: Response): Promise<void> => {
  try {
    const { analysisId } = req.params;
    const userFilter = getUserFilter(req);

    const analysisResult = await AnalysisResult.findById(analysisId)
      .populate({
        path: 'scanRecord',
        populate: {
          path: 'report',
          match: userFilter,
          populate: {
            path: 'patient',
            select: 'name age gender'
          }
        }
      });

    if (!analysisResult || !analysisResult.scanRecord || 
        !(analysisResult.scanRecord as any).report) {
      res.status(404).json({
        success: false,
        message: 'Analysis result not found'
      });
      return;
    }

    res.json({
      success: true,
      data: analysisResult
    });

  } catch (error) {
    console.error('Get analysis result error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get analysis result',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

/**
 * Get scan record status (efficient endpoint for polling)
 */
export const getScanRecordStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const { scanRecordId } = req.params;
    const userFilter = getUserFilter(req);

    // Get scan record with report (to verify access)
    const scanRecord = await ScanRecord.findById(scanRecordId)
      .populate({
        path: 'report',
        match: userFilter
      });

    if (!scanRecord || !scanRecord.report) {
      res.status(404).json({
        success: false,
        message: 'Scan record not found'
      });
      return;
    }

    // Get analysis result if it exists
    const analysisResult = await AnalysisResult.findOne({ scanRecord: scanRecord._id });

    // Return only the essential status information
    res.json({
      success: true,
      data: {
        _id: scanRecord._id,
        analysisStatus: scanRecord.analysisStatus,
        analysisResult: analysisResult || null,
        analysisCompletedAt: scanRecord.analysisCompletedAt,
        analysisStartedAt: scanRecord.analysisStartedAt
      }
    });

  } catch (error) {
    console.error('Get scan record status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get scan record status',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

/**
 * Generate download URL for a file
 */
export const generateDownloadUrl = async (req: Request, res: Response): Promise<void> => {
  try {
    const { scanRecordId } = req.params;
    const { fileType } = req.query;
    const userFilter = getUserFilter(req);

    const scanRecord = await ScanRecord.findById(scanRecordId)
      .populate({
        path: 'report',
        match: userFilter
      });
    
    if (!scanRecord || !scanRecord.report) {
      res.status(404).json({
        success: false,
        message: 'Scan record not found'
      });
      return;
    }

    let fileKey: string | undefined;
    
    switch (fileType) {
      case 'original':
        fileKey = scanRecord.originalFileKey;
        break;
      case 'analyzed':
        fileKey = scanRecord.analyzedFileKey;
        break;
      case 'report':
        fileKey = scanRecord.reportFileKey;
        break;
      default:
        fileKey = scanRecord.originalFileKey;
    }

    if (!fileKey) {
      res.status(404).json({
        success: false,
        message: 'File not found'
      });
      return;
    }

    // For large files (3D DICOM), use longer expiration (24 hours)
    // For smaller files, use 1 hour
    const fileSize = scanRecord.fileSize || 0;
    const expiresIn = fileSize > 100 * 1024 * 1024 ? 86400 : 3600; // 24 hours for files > 100MB, 1 hour otherwise
    
    const downloadUrl = await WasabiStorageService.generateDownloadUrl(fileKey, expiresIn);

    res.json({
      success: true,
      data: {
        downloadUrl,
        expiresIn: 3600
      }
    });

  } catch (error) {
    console.error('Generate download URL error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate download URL',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

/**
 * Get all radiology reports for a patient
 */
export const getPatientRadiologyReports = async (req: Request, res: Response): Promise<void> => {
  try {
    const { patientId } = req.params;
    const { page = 1, limit = 10, status } = req.query;
    const userFilter = getUserFilter(req);

    const patient = await Patient.findOne({ _id: patientId, ...userFilter });
    if (!patient) {
      res.status(404).json({
        success: false,
        message: 'Patient not found'
      });
      return;
    }

    const query: any = { patient: patientId, ...userFilter };
    if (status) {
      query.status = status;
    }

    const reports = await RadiologyReport.find(query)
      .populate('patient', 'name age gender')
      .sort({ createdAt: -1 })
      .limit(Number(limit) * 1)
      .skip((Number(page) - 1) * Number(limit));

    const total = await RadiologyReport.countDocuments(query);

    res.json({
      success: true,
      data: {
        reports,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          pages: Math.ceil(total / Number(limit))
        }
      }
    });

  } catch (error) {
    console.error('Get patient radiology reports error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get patient radiology reports',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

/**
 * Delete radiology report and associated files
 */
export const deleteRadiologyReport = async (req: Request, res: Response): Promise<void> => {
  try {
    const { reportId } = req.params;

    const isObjectId = /^[0-9a-fA-F]{24}$/.test(reportId);
    const userFilter = getUserFilter(req);
    
    let report;
    if (isObjectId) {
      report = await RadiologyReport.findOne({ _id: reportId, ...userFilter });
    } else {
      report = await RadiologyReport.findOne({ reportId, ...userFilter });
    }
    
    if (!report) {
      res.status(404).json({
        success: false,
        message: 'Radiology report not found'
      });
      return;
    }

    // Get all scan records for this report
    const scanRecords = await ScanRecord.find({ report: report._id });

    // Delete files from Wasabi storage
    for (const scanRecord of scanRecords) {
      try {
        if (scanRecord.originalFileKey) {
          await WasabiStorageService.deleteFile(scanRecord.originalFileKey);
        }
        if (scanRecord.analyzedFileKey) {
          await WasabiStorageService.deleteFile(scanRecord.analyzedFileKey);
        }
        if (scanRecord.reportFileKey) {
          await WasabiStorageService.deleteFile(scanRecord.reportFileKey);
        }
      } catch (error) {
        console.error(`Failed to delete files for scan record ${scanRecord._id}:`, error);
        // Continue with deletion even if file deletion fails
      }
    }

    // Delete analysis results
    await AnalysisResult.deleteMany({ 
      scanRecord: { $in: scanRecords.map(sr => sr._id) } 
    });

    // Delete scan records
    await ScanRecord.deleteMany({ report: report._id });

    // Delete the report
    await RadiologyReport.findByIdAndDelete(report._id);

    res.json({
      success: true,
      message: 'Radiology report and associated files deleted successfully'
    });

  } catch (error) {
    console.error('Delete radiology report error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete radiology report',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

/**
 * Delete scan record and associated files
 */
export const deleteScanRecord = async (req: Request, res: Response): Promise<void> => {
  try {
    const { scanRecordId } = req.params;
    const userFilter = getUserFilter(req);

    const scanRecord = await ScanRecord.findById(scanRecordId)
      .populate({
        path: 'report',
        match: userFilter
      });
    
    if (!scanRecord || !scanRecord.report) {
      res.status(404).json({
        success: false,
        message: 'Scan record not found'
      });
      return;
    }

    // Delete files from Wasabi storage
    try {
      if (scanRecord.originalFileKey) {
        await WasabiStorageService.deleteFile(scanRecord.originalFileKey);
      }
      if (scanRecord.analyzedFileKey) {
        await WasabiStorageService.deleteFile(scanRecord.analyzedFileKey);
      }
      if (scanRecord.reportFileKey) {
        await WasabiStorageService.deleteFile(scanRecord.reportFileKey);
      }
    } catch (error) {
      console.error(`Failed to delete files for scan record ${scanRecord._id}:`, error);
      // Continue with deletion even if file deletion fails
    }

    // Delete analysis results
    await AnalysisResult.deleteMany({ scanRecord: scanRecord._id });

    // Delete the scan record
    await ScanRecord.findByIdAndDelete(scanRecord._id);

    res.json({
      success: true,
      message: 'Scan record and associated files deleted successfully'
    });

  } catch (error) {
    console.error('Delete scan record error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete scan record',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

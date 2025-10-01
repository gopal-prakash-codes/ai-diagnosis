import { Request, Response } from 'express';
import { RadiologyReport } from '../models/RadiologyReport';
import { ScanRecord } from '../models/ScanRecord';
import { AnalysisResult } from '../models/AnalysisResult';
import { Patient } from '../models/Patient';
import WasabiStorageService from '../services/wasabiStorage';
import AnalysisIntegrationService from '../services/analysisIntegration';
import multer from 'multer';
import { validationResult } from 'express-validator';

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 200 * 1024 * 1024, 
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
      doctor,
      clinicName,
      clinicAddress,
      symptoms,
      diagnosis,
      confidence,
      treatment
    } = req.body;

    // Verify patient exists
    const patient = await Patient.findById(patientId);
    if (!patient) {
      res.status(404).json({
        success: false,
        message: 'Patient not found'
      });
      return;
    }

    // Generate unique report ID
    const reportId = `RPT-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const report = new RadiologyReport({
      patient: patientId,
      reportId,
      reportType: reportType || 'Report',
      doctor: doctor || 'Dr. [To be filled]',
      clinicName: clinicName || 'Clinic [To be filled]',
      clinicAddress: clinicAddress || 'Address [To be filled]',
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
    console.log('🔍 GET /api/radiology/reports/:reportId called with ID:', reportId);

    const isObjectId = /^[0-9a-fA-F]{24}$/.test(reportId);
    console.log('📋 ID format detected:', isObjectId ? 'MongoDB ObjectId' : 'Custom Report ID');
    
    let report;
    if (isObjectId) {
      console.log('🔎 Searching by MongoDB _id...');
      report = await RadiologyReport.findById(reportId)
        .populate('patient', 'name age gender');
    } else {
      console.log('🔎 Searching by custom reportId field...');
      report = await RadiologyReport.findOne({ reportId })
        .populate('patient', 'name age gender');
    }
    
    console.log('📊 Report found:', report ? 'YES' : 'NO');
    if (report) {
      console.log('📄 Report details:', {
        _id: report._id,
        reportId: report.reportId,
        patientName: report.patient?.name
      });
    } else {
      console.log('🔍 Debug: Checking what reports exist in database...');
      const allReports = await RadiologyReport.find({}).limit(5).select('_id reportId patient');
      console.log('📋 Found', allReports.length, 'reports in database');
      if (allReports.length > 0) {
        console.log('📋 Available reports:', allReports.map(r => ({ _id: r._id, reportId: r.reportId })));
      } else {
        console.log('📋 No reports found in database - database might be empty');
      }
    }

    if (!report) {
      res.status(404).json({
        success: false,
        message: 'Radiology report not found'
      });
      return;
    }

    // Get associated scan records
    const scanRecords = await ScanRecord.find({ report: report._id })
      .populate('report', 'reportId reportType');

    // Get analysis results for each scan record
    const scanRecordsWithResults = await Promise.all(
      scanRecords.map(async (scan) => {
        const analysisResult = await AnalysisResult.findOne({ scanRecord: scan._id });
        return {
          ...scan.toObject(),
          analysisResult
        };
      })
    );

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
  try {
    const { reportId } = req.params;
    const { scanType } = req.body;

    if (!scanType) {
      res.status(400).json({
        success: false,
        message: 'Scan type is required'
      });
      return;
    }

    // Find the report - handle both ObjectId and custom reportId
    const isObjectId = /^[0-9a-fA-F]{24}$/.test(reportId);
    
    let report;
    if (isObjectId) {
      report = await RadiologyReport.findById(reportId);
    } else {
      report = await RadiologyReport.findOne({ reportId });
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

    // Process image file (2D analysis)
    if (files.image && files.image[0]) {
      const imageFile = files.image[0];
      
      try {
        // Upload to Wasabi
        const uploadResult = await WasabiStorageService.uploadImage(
          imageFile.buffer,
          imageFile.originalname,
          {
            'reportid': reportId.replace(/[^\w]/g, ''),
            'scantype': scanType.replace(/[^\w]/g, ''),
            'patientid': report.patient.toString().replace(/[^\w]/g, '')
          }
        );

        // Create scan record
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

    // Process ZIP file (3D analysis)
    if (files.zipFile && files.zipFile[0]) {
      const zipFile = files.zipFile[0];
      
      try {
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

        uploadResults.push({
          type: '3D',
          scanRecord,
          uploadResult
        });

      } catch (error) {
        console.error('ZIP upload error:', error);
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

    // Update report status
    report.status = 'in_progress';
    await report.save();

    res.json({
      success: true,
      message: 'Files uploaded successfully',
      data: uploadResults
    });

  } catch (error) {
    console.error('Upload scan files error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload scan files',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

/**
 * Start analysis for a scan record
 */
export const startAnalysis = async (req: Request, res: Response): Promise<void> => {
  try {
    const { scanRecordId } = req.params;
    const { analysisType } = req.body;

    const scanRecord = await ScanRecord.findById(scanRecordId);
    if (!scanRecord) {
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
      res.status(500).json({
        success: false,
        message: 'Failed to start analysis',
        error: error instanceof Error ? error.message : 'Unknown error'
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

    const report = await RadiologyReport.findById(reportId);
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

    const analysisResult = await AnalysisResult.findById(analysisId);
    if (!analysisResult) {
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

    const analysisResult = await AnalysisResult.findById(analysisId)
      .populate({
        path: 'scanRecord',
        populate: {
          path: 'report',
          populate: {
            path: 'patient',
            select: 'name age gender'
          }
        }
      });

    if (!analysisResult) {
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
 * Generate download URL for a file
 */
export const generateDownloadUrl = async (req: Request, res: Response): Promise<void> => {
  try {
    const { scanRecordId } = req.params;
    const { fileType } = req.query; // 'original', 'analyzed', or 'report'

    const scanRecord = await ScanRecord.findById(scanRecordId);
    if (!scanRecord) {
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

    const downloadUrl = await WasabiStorageService.generateDownloadUrl(fileKey, 3600); // 1 hour expiry

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

    const query: any = { patient: patientId };
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

    // Find the report - handle both ObjectId and custom reportId
    const isObjectId = /^[0-9a-fA-F]{24}$/.test(reportId);
    
    let report;
    if (isObjectId) {
      report = await RadiologyReport.findById(reportId);
    } else {
      report = await RadiologyReport.findOne({ reportId });
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

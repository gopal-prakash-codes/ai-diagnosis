import fetch from 'node-fetch';
import { ScanRecord } from '../models/ScanRecord';
import { AnalysisResult } from '../models/AnalysisResult';
import { RadiologyReport } from '../models/RadiologyReport';
import WasabiStorageService from './wasabiStorage';
import dotenv from 'dotenv';

dotenv.config();

const PYTHON_API_BASE_URL = process.env.PYTHON_API_BASE_URL || 'http://localhost:8000';

export interface Analysis2DResult {
  modality?: string;
  urgency: string;
  findings: string;
  diagnosis: string;
  treatment_plan: string;
  confidence_summary?: string;
  limitations?: string;
  raw_text?: string;
  debug?: {
    perception?: any;
    rules_applied?: string[];
    self_check_notes?: string;
  };
}

export interface Analysis3DJobResponse {
  job_id: string;
  status: string;
}

export interface Analysis3DStatusResponse {
  job_id: string;
  state: string;
  status: string;
  job_state: string;
  outputs?: any;
  error?: string;
}

export class AnalysisIntegrationService {
  
  /**
   * Perform 2D image analysis
   */
  static async analyze2DImage(scanRecordId: string): Promise<void> {
    try {
      const scanRecord = await ScanRecord.findById(scanRecordId);
      if (!scanRecord) {
        throw new Error('Scan record not found');
      }

      // Update status to processing
      scanRecord.analysisStatus = 'processing';
      scanRecord.analysisStartedAt = new Date();
      await scanRecord.save();

      // Create analysis result record
      const analysisResult = new AnalysisResult({
        scanRecord: scanRecord._id,
        analysisType: '2D',
        analysisStartedAt: new Date(),
        analysisStatus: 'processing',
        apiEndpoint: `${PYTHON_API_BASE_URL}/analyze`,
        apiVersion: '1.0'
      });
      await analysisResult.save();

      // Download file from Wasabi
      const downloadUrl = await WasabiStorageService.generateDownloadUrl(scanRecord.originalFileKey);
      const fileResponse = await fetch(downloadUrl);
      
      if (!fileResponse.ok) {
        throw new Error('Failed to download file from storage');
      }

      const fileBuffer = await fileResponse.buffer();

      // Create FormData for API request
      const FormData = require('form-data');
      const formData = new FormData();
      
      // Set max listeners to prevent memory leak warning
      formData.setMaxListeners(20);
      
      formData.append('file', fileBuffer, {
        filename: scanRecord.originalFileName,
        contentType: scanRecord.mimeType
      });

      console.log(`📤 Sending to Python API: ${PYTHON_API_BASE_URL}/analyze`);
      console.log(`📄 File: ${scanRecord.originalFileName} (${scanRecord.mimeType}, ${fileBuffer.length} bytes)`);

      // Call Python FastAPI backend for analysis with retry logic
      let response;
      let lastError;
      const maxRetries = 5; // Increased retries for Render.com cold starts
      
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          console.log(`Attempting 2D analysis (attempt ${attempt}/${maxRetries})`);
          
          response = await fetch(`${PYTHON_API_BASE_URL}/analyze`, {
            method: 'POST',
            body: formData,
            headers: {
              ...formData.getHeaders(),
              'X-API-Key': process.env.BACKEND_API_KEY || '', // Add API key if available
            },
            timeout: 120000 // 2 minute timeout for Render.com cold starts
          });

          if (response.ok) {
            break; // Success, exit retry loop
          }
          
          const errorText = await response.text();
          lastError = `Python Analysis API error: ${response.status} - ${errorText}`;
          
          // Check for specific error types
          if (errorText.includes('Cloudflare Tunnel error') || response.status === 530) {
            lastError = 'Python Analysis Service is temporarily unavailable (Cloudflare Tunnel error). Please try again later.';
          } else if (errorText.includes('Non-medical image detected')) {
            lastError = 'The uploaded image was not recognized as a medical image. Please upload a valid medical scan, X-ray, or diagnostic image.';
            // Don't retry for non-medical images
            break;
          } else if (errorText.includes('Only PNG/JPG images are supported')) {
            lastError = 'Invalid image format. Please upload PNG or JPEG images only.';
            break;
          } else if (errorText.includes('File too large')) {
            lastError = 'File size too large. Please upload images smaller than 50MB.';
            break;
          }
          
          console.warn(`Analysis attempt ${attempt} failed:`, lastError);
          
          if (attempt < maxRetries) {
            // Wait before retrying (longer delays for Render.com cold starts)
            const delay = attempt <= 2 ? 10000 : Math.pow(2, attempt) * 2000; // 10s for first 2 attempts, then exponential
            console.log(`Waiting ${delay/1000}s before retry...`);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
          
        } catch (fetchError) {
          lastError = `Network error connecting to Python Analysis Service: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}`;
          console.warn(`Analysis attempt ${attempt} failed:`, lastError);
          
          if (attempt < maxRetries) {
            // Wait before retrying (longer delays for Render.com cold starts)
            const delay = attempt <= 2 ? 10000 : Math.pow(2, attempt) * 2000; // 10s for first 2 attempts, then exponential
            console.log(`Waiting ${delay/1000}s before retry...`);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }

      if (!response || !response.ok) {
        throw new Error(lastError || 'Failed to connect to Python Analysis Service after multiple attempts');
      }

      const result: Analysis2DResult = await response.json() as Analysis2DResult;

      // Update analysis result
      analysisResult.analysisStatus = 'completed';
      analysisResult.analysisCompletedAt = new Date();
      analysisResult.modality = result.modality;
      analysisResult.urgency = result.urgency as 'Routine' | 'Priority' | 'Emergency';
      analysisResult.findings = result.findings;
      analysisResult.diagnosis = result.diagnosis;
      analysisResult.treatmentPlan = result.treatment_plan;
      analysisResult.confidenceSummary = result.confidence_summary;
      analysisResult.limitations = result.limitations;
      analysisResult.rawData = result;
      analysisResult.debugInfo = result.debug;

      await analysisResult.save();

      // Update the main report with analysis results
      try {
        console.log('Updating main report with analysis results...');
        await updateMainReportWithAnalysis(scanRecord.report.toString(), result);
      } catch (updateError) {
        console.error('Failed to update main report with analysis results:', updateError);
        // Don't fail the entire analysis if report update fails
      }

      // Update scan record
      scanRecord.analysisStatus = 'completed';
      scanRecord.analysisCompletedAt = new Date();
      await scanRecord.save();

      console.log(`2D Analysis completed for scan record ${scanRecordId}`);

    } catch (error) {
      console.error(`2D Analysis failed for scan record ${scanRecordId}:`, error);
      
      // Update records with error status
      await ScanRecord.findByIdAndUpdate(scanRecordId, {
        analysisStatus: 'failed',
        analysisCompletedAt: new Date()
      });

      await AnalysisResult.findOneAndUpdate(
        { scanRecord: scanRecordId },
        {
          analysisStatus: 'failed',
          analysisCompletedAt: new Date(),
          errorMessage: error instanceof Error ? error.message : 'Unknown error'
        }
      );
    }
  }

  /**
   * Start 3D DICOM analysis
   */
  static async start3DAnalysis(scanRecordId: string): Promise<string> {
    try {
      const scanRecord = await ScanRecord.findById(scanRecordId);
      if (!scanRecord) {
        throw new Error('Scan record not found');
      }

      // Update status to processing
      scanRecord.analysisStatus = 'processing';
      scanRecord.analysisStartedAt = new Date();
      await scanRecord.save();

      // Download file from Wasabi
      const downloadUrl = await WasabiStorageService.generateDownloadUrl(scanRecord.originalFileKey);
      const fileResponse = await fetch(downloadUrl);
      
      if (!fileResponse.ok) {
        throw new Error('Failed to download file from storage');
      }

      const fileBuffer = await fileResponse.buffer();

      // Create FormData for API request
      const FormData = require('form-data');
      const formData = new FormData();
      
      // Set max listeners to prevent memory leak warning
      formData.setMaxListeners(20);
      
      formData.append('file', fileBuffer, {
        filename: scanRecord.originalFileName,
        contentType: scanRecord.mimeType
      });

      // Call Python FastAPI backend for 3D analysis job submission with retry logic
      let response;
      let lastError;
      const maxRetries = 3;
      
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          console.log(`Attempting 3D analysis job submission (attempt ${attempt}/${maxRetries})`);
          
          response = await fetch(`${PYTHON_API_BASE_URL}/jobs`, {
            method: 'POST',
            body: formData,
            headers: formData.getHeaders(),
            timeout: 60000 // 60 second timeout
          });

          if (response.ok) {
            break; // Success, exit retry loop
          }
          
          const errorText = await response.text();
          lastError = `Python 3D Analysis API error: ${response.status} - ${errorText}`;
          
          // Check if it's a Cloudflare tunnel error
          if (errorText.includes('Cloudflare Tunnel error') || response.status === 530) {
            lastError = 'Python Analysis Service is temporarily unavailable (Cloudflare Tunnel error). Please try again later.';
          }
          
          console.warn(`3D analysis attempt ${attempt} failed:`, lastError);
          
          if (attempt < maxRetries) {
            // Wait before retrying (exponential backoff)
            await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
          }
          
        } catch (fetchError) {
          lastError = `Network error connecting to Python Analysis Service: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}`;
          console.warn(`3D analysis attempt ${attempt} failed:`, lastError);
          
          if (attempt < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
          }
        }
      }

      if (!response || !response.ok) {
        throw new Error(lastError || 'Failed to connect to Python Analysis Service after multiple attempts');
      }

      const result: Analysis3DJobResponse = await response.json() as Analysis3DJobResponse;
      const jobId = result.job_id || result.status;

      if (!jobId) {
        throw new Error('No job ID returned from analysis API');
      }

      // Create analysis result record
      const analysisResult = new AnalysisResult({
        scanRecord: scanRecord._id,
        analysisType: '3D',
        jobId: jobId,
        analysisStartedAt: new Date(),
        analysisStatus: 'processing',
        apiEndpoint: `${PYTHON_API_BASE_URL}/jobs`,
        apiVersion: '1.0'
      });
      await analysisResult.save();

      // Update scan record with job ID
      scanRecord.analysisJobId = jobId;
      await scanRecord.save();

      console.log(`3D Analysis started for scan record ${scanRecordId}, job ID: ${jobId}`);
      
      // Start polling for job status
      this.poll3DJobStatus(jobId, scanRecordId);

      return jobId;

    } catch (error) {
      console.error(`3D Analysis failed to start for scan record ${scanRecordId}:`, error);
      
      // Update records with error status
      await ScanRecord.findByIdAndUpdate(scanRecordId, {
        analysisStatus: 'failed',
        analysisCompletedAt: new Date()
      });

      throw error;
    }
  }

  /**
   * Poll 3D job status
   */
  private static async poll3DJobStatus(jobId: string, scanRecordId: string): Promise<void> {
    let attempts = 0;
    const maxAttempts = 200; // ~10 minutes max
    const pollInterval = 3000; // 3 seconds

    const poll = async () => {
      try {
        attempts++;

        if (attempts > maxAttempts) {
          console.log(`Polling timeout for job ${jobId}`);
          await this.handle3DJobTimeout(jobId, scanRecordId);
          return;
        }

        const statusResponse = await fetch(`${PYTHON_API_BASE_URL}/jobs/${encodeURIComponent(jobId)}`);
        
        if (!statusResponse.ok) {
          console.error(`Status check failed for job ${jobId}: ${statusResponse.status}`);
          setTimeout(poll, pollInterval);
          return;
        }

        const statusData: Analysis3DStatusResponse = await statusResponse.json() as Analysis3DStatusResponse;
        const state = statusData.state || statusData.status || statusData.job_state;

        console.log(`Job ${jobId} status: ${state} (attempt ${attempts})`);

        if (state === 'completed' || state === 'finished' || state === 'succeeded' || statusData.outputs) {
          await this.handle3DJobCompletion(jobId, scanRecordId, statusData);
        } else if (state === 'failed' || state === 'error') {
          await this.handle3DJobFailure(jobId, scanRecordId, statusData);
        } else {
          // Continue polling
          setTimeout(poll, pollInterval);
        }

      } catch (error) {
        console.error(`Polling error for job ${jobId}:`, error);
        setTimeout(poll, pollInterval);
      }
    };

    // Start polling
    setTimeout(poll, pollInterval);
  }

  /**
   * Handle 3D job completion
   */
  private static async handle3DJobCompletion(
    jobId: string, 
    scanRecordId: string, 
    statusData: Analysis3DStatusResponse
  ): Promise<void> {
    try {
      // Update analysis result
      await AnalysisResult.findOneAndUpdate(
        { jobId: jobId },
        {
          analysisStatus: 'completed',
          analysisCompletedAt: new Date(),
          rawData: statusData
        }
      );

      // Update scan record
      await ScanRecord.findByIdAndUpdate(scanRecordId, {
        analysisStatus: 'completed',
        analysisCompletedAt: new Date()
      });

      console.log(`3D Analysis completed for job ${jobId}`);

    } catch (error) {
      console.error(`Error handling 3D job completion for ${jobId}:`, error);
    }
  }

  /**
   * Handle 3D job failure
   */
  private static async handle3DJobFailure(
    jobId: string, 
    scanRecordId: string, 
    statusData: Analysis3DStatusResponse
  ): Promise<void> {
    try {
      const errorMessage = statusData.error || 'Analysis failed';

      // Update analysis result
      await AnalysisResult.findOneAndUpdate(
        { jobId: jobId },
        {
          analysisStatus: 'failed',
          analysisCompletedAt: new Date(),
          errorMessage: errorMessage,
          rawData: statusData
        }
      );

      // Update scan record
      await ScanRecord.findByIdAndUpdate(scanRecordId, {
        analysisStatus: 'failed',
        analysisCompletedAt: new Date()
      });

      console.log(`3D Analysis failed for job ${jobId}: ${errorMessage}`);

    } catch (error) {
      console.error(`Error handling 3D job failure for ${jobId}:`, error);
    }
  }

  /**
   * Handle 3D job timeout
   */
  private static async handle3DJobTimeout(jobId: string, scanRecordId: string): Promise<void> {
    try {
      // Update analysis result
      await AnalysisResult.findOneAndUpdate(
        { jobId: jobId },
        {
          analysisStatus: 'timeout',
          analysisCompletedAt: new Date(),
          errorMessage: 'Analysis timed out'
        }
      );

      // Update scan record
      await ScanRecord.findByIdAndUpdate(scanRecordId, {
        analysisStatus: 'failed',
        analysisCompletedAt: new Date()
      });

      console.log(`3D Analysis timed out for job ${jobId}`);

    } catch (error) {
      console.error(`Error handling 3D job timeout for ${jobId}:`, error);
    }
  }

  /**
   * Check 3D job status manually
   */
  static async check3DJobStatus(jobId: string): Promise<Analysis3DStatusResponse> {
    try {
      const response = await fetch(`${PYTHON_API_BASE_URL}/jobs/${encodeURIComponent(jobId)}`);
      
      if (!response.ok) {
        throw new Error(`Status check failed: ${response.status}`);
      }

      return await response.json() as Analysis3DStatusResponse;

    } catch (error) {
      console.error(`Error checking job status for ${jobId}:`, error);
      throw error;
    }
  }

  /**
   * Download 3D job result
   */
  static async download3DJobResult(jobId: string): Promise<Buffer> {
    try {
      const response = await fetch(`${PYTHON_API_BASE_URL}/jobs/${jobId}/result`);
      
      if (!response.ok) {
        throw new Error(`Download failed: ${response.status}`);
      }

      return await response.buffer();

    } catch (error) {
      console.error(`Error downloading result for job ${jobId}:`, error);
      throw error;
    }
  }
}

/**
 * Update the main radiology report with analysis results
 */
async function updateMainReportWithAnalysis(reportId: string, analysisResult: Analysis2DResult): Promise<void> {
  try {
    const report = await RadiologyReport.findById(reportId);
    if (!report) {
      console.warn(`Report ${reportId} not found for analysis update`);
      return;
    }

    // Extract meaningful data from analysis result
    let diagnosis = analysisResult.diagnosis || 'Analysis completed';
    let treatment = analysisResult.treatment_plan || 'Treatment plan pending';
    let symptoms: string[] = [];
    let confidence: number | undefined;

    // Extract confidence from confidence_summary if available
    if (analysisResult.confidence_summary) {
      const confidenceMatch = analysisResult.confidence_summary.match(/(\d+)%?/);
      if (confidenceMatch) {
        confidence = parseInt(confidenceMatch[1]);
      }
    }

    // Extract symptoms from debug data if available
    if (analysisResult.debug?.perception?.candidate_information) {
      const candidateInfo = analysisResult.debug.perception.candidate_information;
      symptoms = [`Age: ${candidateInfo.age}`, `Gender: ${candidateInfo.gender}`, `Profession: ${candidateInfo.profession}`];
    } else if (analysisResult.findings) {
      // Use findings as symptoms if no candidate info
      symptoms = [analysisResult.findings.substring(0, 200)]; // Truncate if too long
    }

    // Update report fields
    if (diagnosis && diagnosis !== 'Analysis completed') {
      report.diagnosis = diagnosis;
    }
    
    if (treatment && treatment !== 'Treatment plan pending') {
      report.treatment = treatment;
    }
    
    if (symptoms.length > 0) {
      report.symptoms = symptoms;
    }
    
    if (confidence !== undefined) {
      report.confidence = confidence;
    }

    // Update status to completed
    report.status = 'completed';

    await report.save();
    console.log(`Report ${reportId} updated with analysis results`);

  } catch (error) {
    console.error('Error updating report with analysis results:', error);
    throw error;
  }
}

export default AnalysisIntegrationService;

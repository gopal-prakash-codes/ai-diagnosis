import mongoose, { Document, Schema } from 'mongoose';
import { IScanRecord } from './ScanRecord';

export interface IAnalysisResult extends Document {
  scanRecord: IScanRecord['_id'];
  analysisType: '2D' | '3D';
  jobId?: string;
  
  // Analysis results for 2D scans
  modality?: string;
  urgency?: 'Routine' | 'Priority' | 'Emergency';
  findings?: string;
  diagnosis?: string;
  treatmentPlan?: string;
  confidenceSummary?: string;
  limitations?: string;
  
  // Raw analysis data
  rawData?: any;
  debugInfo?: any;
  
  // Analysis metadata
  analysisStartedAt: Date;
  analysisCompletedAt?: Date;
  analysisStatus: 'processing' | 'completed' | 'failed' | 'timeout';
  errorMessage?: string;
  
  // Processing information
  processingTime?: number; // in seconds
  apiEndpoint?: string;
  apiVersion?: string;
  
  createdAt: Date;
  updatedAt: Date;
}

const analysisResultSchema = new Schema<IAnalysisResult>({
  scanRecord: {
    type: Schema.Types.ObjectId,
    ref: 'ScanRecord',
    required: [true, 'Scan record reference is required']
  },
  analysisType: {
    type: String,
    required: [true, 'Analysis type is required'],
    enum: {
      values: ['2D', '3D'],
      message: 'Analysis type must be 2D or 3D'
    }
  },
  jobId: {
    type: String,
    trim: true,
    sparse: true // For 3D analysis job tracking
  },
  
  // Analysis results for 2D scans
  modality: {
    type: String,
    trim: true,
    maxlength: [100, 'Modality cannot exceed 100 characters']
  },
  urgency: {
    type: String,
    enum: {
      values: ['Routine', 'Priority', 'Emergency'],
      message: 'Urgency must be Routine, Priority, or Emergency'
    }
  },
  findings: {
    type: String,
    trim: true,
    maxlength: [5000, 'Findings cannot exceed 5000 characters']
  },
  diagnosis: {
    type: String,
    trim: true,
    maxlength: [2000, 'Diagnosis cannot exceed 2000 characters']
  },
  treatmentPlan: {
    type: String,
    trim: true,
    maxlength: [3000, 'Treatment plan cannot exceed 3000 characters']
  },
  confidenceSummary: {
    type: String,
    trim: true,
    maxlength: [1000, 'Confidence summary cannot exceed 1000 characters']
  },
  limitations: {
    type: String,
    trim: true,
    maxlength: [1000, 'Limitations cannot exceed 1000 characters']
  },
  
  // Raw analysis data
  rawData: {
    type: Schema.Types.Mixed,
    default: null
  },
  debugInfo: {
    type: Schema.Types.Mixed,
    default: null
  },
  
  // Analysis metadata
  analysisStartedAt: {
    type: Date,
    required: [true, 'Analysis start time is required'],
    default: Date.now
  },
  analysisCompletedAt: {
    type: Date
  },
  analysisStatus: {
    type: String,
    required: [true, 'Analysis status is required'],
    enum: {
      values: ['processing', 'completed', 'failed', 'timeout'],
      message: 'Analysis status must be processing, completed, failed, or timeout'
    },
    default: 'processing'
  },
  errorMessage: {
    type: String,
    trim: true,
    maxlength: [1000, 'Error message cannot exceed 1000 characters']
  },
  
  // Processing information
  processingTime: {
    type: Number,
    min: [0, 'Processing time cannot be negative']
  },
  apiEndpoint: {
    type: String,
    trim: true,
    maxlength: [200, 'API endpoint cannot exceed 200 characters']
  },
  apiVersion: {
    type: String,
    trim: true,
    maxlength: [50, 'API version cannot exceed 50 characters']
  }
}, {
  timestamps: true
});

// Indexes for better query performance
analysisResultSchema.index({ scanRecord: 1 });
analysisResultSchema.index({ analysisType: 1 });
analysisResultSchema.index({ jobId: 1 });
analysisResultSchema.index({ analysisStatus: 1 });
analysisResultSchema.index({ analysisStartedAt: -1 });
analysisResultSchema.index({ analysisCompletedAt: -1 });
analysisResultSchema.index({ urgency: 1 });
analysisResultSchema.index({ createdAt: -1 });

// Compound indexes
analysisResultSchema.index({ scanRecord: 1, analysisStatus: 1 });
analysisResultSchema.index({ analysisType: 1, analysisStatus: 1 });

// Populate scan record when querying
analysisResultSchema.pre('find', function() {
  this.populate('scanRecord', 'fileName scanType fileType report');
});

analysisResultSchema.pre('findOne', function() {
  this.populate('scanRecord', 'fileName scanType fileType report');
});

// Calculate processing time before saving
analysisResultSchema.pre('save', function(next) {
  if (this.analysisCompletedAt && this.analysisStartedAt && !this.processingTime) {
    this.processingTime = Math.round((this.analysisCompletedAt.getTime() - this.analysisStartedAt.getTime()) / 1000);
  }
  next();
});

export const AnalysisResult = mongoose.model<IAnalysisResult>('AnalysisResult', analysisResultSchema);

import mongoose, { Document, Schema } from 'mongoose';
import { IRadiologyReport } from './RadiologyReport';

export interface IScanRecord extends Document {
  report: IRadiologyReport['_id'];
  scanType: 'Report' | 'MRI' | 'CT-SCAN' | 'X-RAY';
  fileName: string;
  originalFileName: string;
  fileType: '2D' | '3D';
  fileSize: number;
  mimeType: string;
  
  // Wasabi S3 storage references
  originalFileUrl: string;
  originalFileKey: string;
  
  // Analysis status and results
  analysisStatus: 'pending' | 'processing' | 'completed' | 'failed';
  analysisJobId?: string;
  analysisStartedAt?: Date;
  analysisCompletedAt?: Date;
  
  // Processed file references (for analyzed results)
  analyzedFileUrl?: string;
  analyzedFileKey?: string;
  
  // Report file references
  reportFileUrl?: string;
  reportFileKey?: string;
  
  // Metadata
  uploadedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const scanRecordSchema = new Schema<IScanRecord>({
  report: {
    type: Schema.Types.ObjectId,
    ref: 'RadiologyReport',
    required: [true, 'Report reference is required']
  },
  scanType: {
    type: String,
    required: [true, 'Scan type is required'],
    enum: {
      values: ['Report', 'MRI', 'CT-SCAN', 'X-RAY'],
      message: 'Scan type must be Report, MRI, CT-SCAN, or X-RAY'
    }
  },
  fileName: {
    type: String,
    required: [true, 'File name is required'],
    trim: true,
    maxlength: [255, 'File name cannot exceed 255 characters']
  },
  originalFileName: {
    type: String,
    required: [true, 'Original file name is required'],
    trim: true,
    maxlength: [255, 'Original file name cannot exceed 255 characters']
  },
  fileType: {
    type: String,
    required: [true, 'File type is required'],
    enum: {
      values: ['2D', '3D'],
      message: 'File type must be 2D or 3D'
    }
  },
  fileSize: {
    type: Number,
    required: [true, 'File size is required'],
    min: [0, 'File size cannot be negative']
  },
  mimeType: {
    type: String,
    required: [true, 'MIME type is required'],
    trim: true
  },
  
  // Wasabi S3 storage references
  originalFileUrl: {
    type: String,
    required: [true, 'Original file URL is required'],
    trim: true
  },
  originalFileKey: {
    type: String,
    required: [true, 'Original file key is required'],
    trim: true,
    unique: true
  },
  
  // Analysis status and results
  analysisStatus: {
    type: String,
    required: [true, 'Analysis status is required'],
    enum: {
      values: ['pending', 'processing', 'completed', 'failed'],
      message: 'Analysis status must be pending, processing, completed, or failed'
    },
    default: 'pending'
  },
  analysisJobId: {
    type: String,
    trim: true,
    sparse: true // Allows multiple null values
  },
  analysisStartedAt: {
    type: Date
  },
  analysisCompletedAt: {
    type: Date
  },
  
  // Processed file references
  analyzedFileUrl: {
    type: String,
    trim: true
  },
  analyzedFileKey: {
    type: String,
    trim: true,
    sparse: true
  },
  
  // Report file references
  reportFileUrl: {
    type: String,
    trim: true
  },
  reportFileKey: {
    type: String,
    trim: true,
    sparse: true
  },
  
  // Metadata
  uploadedAt: {
    type: Date,
    required: [true, 'Upload date is required'],
    default: Date.now
  }
}, {
  timestamps: true
});

// Indexes for better query performance
scanRecordSchema.index({ report: 1 });
scanRecordSchema.index({ scanType: 1 });
scanRecordSchema.index({ fileType: 1 });
scanRecordSchema.index({ analysisStatus: 1 });
scanRecordSchema.index({ analysisJobId: 1 });
scanRecordSchema.index({ uploadedAt: -1 });
scanRecordSchema.index({ createdAt: -1 });

// Compound indexes
scanRecordSchema.index({ report: 1, scanType: 1 });
scanRecordSchema.index({ report: 1, analysisStatus: 1 });

// Populate report when querying
scanRecordSchema.pre('find', function() {
  this.populate('report', 'reportId reportType patient');
});

scanRecordSchema.pre('findOne', function() {
  this.populate('report', 'reportId reportType patient');
});

export const ScanRecord = mongoose.model<IScanRecord>('ScanRecord', scanRecordSchema);

import mongoose, { Document, Schema } from 'mongoose';
import { IPatient } from './Patient';

export interface IRadiologyReport extends Document {
  user: mongoose.Types.ObjectId;
  organization: mongoose.Types.ObjectId;
  patient: IPatient['_id'];
  reportId: string;
  reportType: string;
  date: Date;
  symptoms: string[];
  diagnosis?: string;
  confidence?: number;
  treatment?: string;
  status: 'draft' | 'in_progress' | 'completed' | 'archived';
  createdAt: Date;
  updatedAt: Date;
}

const radiologyReportSchema = new Schema<IRadiologyReport>({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'User reference is required'],
    index: true
  },
  organization: {
    type: Schema.Types.ObjectId,
    ref: 'Organization',
    required: [true, 'Organization reference is required'],
    index: true
  },
  patient: {
    type: Schema.Types.ObjectId,
    ref: 'Patient',
    required: [true, 'Patient reference is required']
  },
  reportId: {
    type: String,
    required: [true, 'Report ID is required'],
    unique: true,
    trim: true
  },
  reportType: {
    type: String,
    enum: ['Report', 'MRI', 'CT-SCAN', 'X-RAY'],
    default: 'Report',
    trim: true
  },
  date: {
    type: Date,
    default: Date.now
  },
  symptoms: {
    type: [String],
    default: ['Pending Analysis']
  },
  diagnosis: {
    type: String,
    default: 'Pending Analysis - Upload and analyze medical images to generate diagnosis',
    trim: true,
    maxlength: [1000, 'Diagnosis cannot exceed 1000 characters']
  },
  confidence: {
    type: Number,
    default: 0,
    min: [0, 'Confidence cannot be negative'],
    max: [100, 'Confidence cannot exceed 100']
  },
  treatment: {
    type: String,
    default: 'Treatment plan will be generated after image analysis',
    trim: true,
    maxlength: [2000, 'Treatment cannot exceed 2000 characters']
  },
  status: {
    type: String,
    required: [true, 'Status is required'],
    enum: {
      values: ['draft', 'in_progress', 'completed', 'archived'],
      message: 'Status must be draft, in_progress, completed, or archived'
    },
    default: 'draft'
  }
}, {
  timestamps: true
});

radiologyReportSchema.index({ user: 1, patient: 1 });
radiologyReportSchema.index({ user: 1, createdAt: -1 });
radiologyReportSchema.index({ organization: 1 });
radiologyReportSchema.index({ organization: 1, createdAt: -1 });
radiologyReportSchema.index({ patient: 1 });
radiologyReportSchema.index({ reportId: 1 });
radiologyReportSchema.index({ reportType: 1 });
radiologyReportSchema.index({ date: -1 });
radiologyReportSchema.index({ status: 1 });
radiologyReportSchema.index({ createdAt: -1 });

// Populate patient when querying
radiologyReportSchema.pre('find', function() {
  this.populate('patient', 'name age gender');
});

radiologyReportSchema.pre('findOne', function() {
  this.populate('patient', 'name age gender');
});

export const RadiologyReport = mongoose.model<IRadiologyReport>('RadiologyReport', radiologyReportSchema);

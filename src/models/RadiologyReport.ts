import mongoose, { Document, Schema } from 'mongoose';
import { IPatient } from './Patient';

export interface IRadiologyReport extends Document {
  patient: IPatient['_id'];
  reportId: string;
  reportType: string;
  date: Date;
  doctor: string;
  clinicName: string;
  clinicAddress: string;
  symptoms: string[];
  diagnosis?: string;
  confidence?: number;
  treatment?: string;
  status: 'draft' | 'in_progress' | 'completed' | 'archived';
  createdAt: Date;
  updatedAt: Date;
}

const radiologyReportSchema = new Schema<IRadiologyReport>({
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
  doctor: {
    type: String,
    default: 'Dr. [To be filled]',
    trim: true,
    maxlength: [100, 'Doctor name cannot exceed 100 characters']
  },
  clinicName: {
    type: String,
    default: 'Clinic [To be filled]',
    trim: true,
    maxlength: [200, 'Clinic name cannot exceed 200 characters']
  },
  clinicAddress: {
    type: String,
    default: 'Address [To be filled]',
    trim: true,
    maxlength: [500, 'Clinic address cannot exceed 500 characters']
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

// Indexes for better query performance
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

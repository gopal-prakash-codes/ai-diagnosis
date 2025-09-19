import mongoose, { Document, Schema } from 'mongoose';
import { IPatient } from './Patient';

export interface IDiagnosis extends Document {
  patient: IPatient['_id'];
  conversationText: string;
  symptoms: string[];
  allergies?: string[];
  diagnosis: string;
  treatment?: string;
  confidence?: number;
  doctor?: string;
  createdAt: Date;
  updatedAt: Date;
}

const diagnosisSchema = new Schema<IDiagnosis>({
  patient: {
    type: Schema.Types.ObjectId,
    ref: 'Patient',
    required: [true, 'Patient reference is required']
  },
  conversationText: {
    type: String,
    required: [true, 'Conversation text is required'],
    trim: true
  },
  symptoms: {
    type: [String],
    required: [true, 'At least one symptom is required'],
    validate: {
      validator: function(v: string[]) {
        return Array.isArray(v) && v.length > 0;
      },
      message: 'At least one symptom is required'
    }
  },
  allergies: {
    type: [String],
    default: [],
    required: false
  },
  diagnosis: {
    type: String,
    required: [true, 'Diagnosis is required'],
    trim: true
  },
  treatment: {
    type: String,
    trim: true,
    default: null
  },
  confidence: {
    type: Number,
    min: [0, 'Confidence cannot be negative'],
    max: [100, 'Confidence cannot exceed 100'],
    default: null
  },
  doctor: {
    type: String,
    trim: true,
    default: null
  }
}, {
  timestamps: true
});

// Index for better query performance
diagnosisSchema.index({ patient: 1 });
diagnosisSchema.index({ createdAt: -1 });
diagnosisSchema.index({ diagnosis: 1 });

// Populate patient when querying
diagnosisSchema.pre('find', function() {
  this.populate('patient', 'name age gender');
});

diagnosisSchema.pre('findOne', function() {
  this.populate('patient', 'name age gender');
});

export const Diagnosis = mongoose.model<IDiagnosis>('Diagnosis', diagnosisSchema);

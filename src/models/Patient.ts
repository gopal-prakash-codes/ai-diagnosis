import mongoose, { Document, Schema } from 'mongoose';

export interface IPatient extends Document {
  user: mongoose.Types.ObjectId;
  organization: mongoose.Types.ObjectId;
  name: string;
  age: number;
  gender: 'male' | 'female' | 'other';
  createdAt: Date;
  updatedAt: Date;
}

const patientSchema = new Schema<IPatient>({
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
  name: {
    type: String,
    required: [true, 'Patient name is required'],
    trim: true,
    maxlength: [100, 'Name cannot exceed 100 characters']
  },
  age: {
    type: Number,
    required: [true, 'Age is required'],
    min: [0, 'Age cannot be negative'],
    max: [150, 'Age cannot exceed 150']
  },
  gender: {
    type: String,
    required: [true, 'Gender is required'],
    enum: {
      values: ['male', 'female', 'other'],
      message: 'Gender must be male, female, or other'
    }
  }
}, {
  timestamps: true
});

patientSchema.index({ user: 1, name: 1 });
patientSchema.index({ user: 1, createdAt: -1 });
patientSchema.index({ organization: 1 });
patientSchema.index({ organization: 1, createdAt: -1 });
patientSchema.index({ name: 1 });
patientSchema.index({ age: 1 });
patientSchema.index({ gender: 1 });

export const Patient = mongoose.model<IPatient>('Patient', patientSchema);

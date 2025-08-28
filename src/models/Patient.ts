import mongoose, { Document, Schema } from 'mongoose';

export interface IPatient extends Document {
  name: string;
  age: number;
  gender: 'male' | 'female' | 'other';
  createdAt: Date;
  updatedAt: Date;
}

const patientSchema = new Schema<IPatient>({
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

// Index for better query performance
patientSchema.index({ name: 1 });
patientSchema.index({ age: 1 });
patientSchema.index({ gender: 1 });

export const Patient = mongoose.model<IPatient>('Patient', patientSchema);

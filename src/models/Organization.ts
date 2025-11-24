import mongoose, { Document, Schema } from 'mongoose';

export interface IOrganization extends Document {
  name: string;
  admin: mongoose.Types.ObjectId;
  members: mongoose.Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const organizationSchema = new Schema<IOrganization>({
  name: {
    type: String,
    required: [true, 'Organization name is required'],
    trim: true,
    maxlength: [100, 'Organization name cannot exceed 100 characters']
  },
  admin: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Admin reference is required'],
    index: true
  },
  members: [{
    type: Schema.Types.ObjectId,
    ref: 'User'
  }]
}, {
  timestamps: true
});

organizationSchema.index({ admin: 1 });
organizationSchema.index({ members: 1 });

export const Organization = mongoose.model<IOrganization>('Organization', organizationSchema);


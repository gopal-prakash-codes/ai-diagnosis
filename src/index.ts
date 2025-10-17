import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { connectDB } from './config/database';
import { errorHandler } from './middleware/errorHandler';
import authRoutes from './routes/auth';
import userRoutes from './routes/user';
import diagnosisRoutes from './routes/diagnosis';
import patientRoutes from './routes/patient';
import radiologyRoutes from './routes/radiology';
import { authenticateToken } from './middleware/auth';
import WasabiStorageService from './services/wasabiStorage';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet());
app.use(cors({
  origin: '*',
  credentials: true
}));

const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'), // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '500'), 
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 20, 
  message: 'Too many authentication attempts, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    message: 'Server is running',
    timestamp: new Date().toISOString()
  });
});

// Routes
app.use('/api/auth', authLimiter, authRoutes); // Apply stricter rate limit to auth routes
app.use('/api/users', authenticateToken, userRoutes);
app.use('/api/diagnosis', diagnosisRoutes);
app.use('/api/patients', patientRoutes);
app.use('/api/radiology', radiologyRoutes);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

// Error handling middleware
app.use(errorHandler);

// Start server
const startServer = async () => {
  try {
    // Connect to MongoDB
    await connectDB();
    
    // Debug environment variables
    console.log('🔍 Environment variables check:');
    console.log('NODE_ENV:', process.env.NODE_ENV);
    console.log('PORT:', process.env.PORT);
    console.log('WASABI_ACCESS_KEY_ID:', process.env.WASABI_ACCESS_KEY_ID ? 'SET' : 'MISSING');
    console.log('WASABI_SECRET_ACCESS_KEY:', process.env.WASABI_SECRET_ACCESS_KEY ? 'SET' : 'MISSING');
    console.log('WASABI_BUCKET_NAME:', process.env.WASABI_BUCKET_NAME || 'MISSING');
    console.log('PYTHON_API_BASE_URL:', process.env.PYTHON_API_BASE_URL || 'MISSING');

    // Validate Wasabi configuration
    if (WasabiStorageService.validateConfiguration()) {
      console.log('✅ Wasabi storage configuration validated');
      // Test connection (optional)
      try {
        await WasabiStorageService.testConnection();
      } catch (error) {
        console.error('❌ Wasabi connection test failed:', error);
      }
    } else {
      console.warn('⚠️  Wasabi storage not configured properly. File uploads will fail.');
    }
    
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📊 Environment: ${process.env.NODE_ENV}`);
      console.log(`🔗 Health check: http://localhost:${PORT}/health`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

export default app;

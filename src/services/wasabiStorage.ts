import AWS from 'aws-sdk';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

// Configure Wasabi S3-compatible storage
const wasabiEndpoint = process.env.WASABI_ENDPOINT || 'https://s3.wasabisys.com';
const wasabiBucket = process.env.WASABI_BUCKET_NAME || 'ai-diagnosis-storage';

// Validate credentials before creating S3 instance
const accessKeyId = process.env.WASABI_ACCESS_KEY_ID;
const secretAccessKey = process.env.WASABI_SECRET_ACCESS_KEY;
const region = process.env.WASABI_REGION || 'us-east-1';

if (!accessKeyId || !secretAccessKey) {
  console.error('Missing Wasabi credentials:');
  console.error('WASABI_ACCESS_KEY_ID:', accessKeyId ? 'SET' : 'MISSING');
  console.error('WASABI_SECRET_ACCESS_KEY:', secretAccessKey ? 'SET' : 'MISSING');
  console.error('WASABI_BUCKET_NAME:', wasabiBucket);
  console.error('WASABI_REGION:', region);
  console.error('WASABI_ENDPOINT:', wasabiEndpoint);
}

const s3 = new AWS.S3({
  endpoint: wasabiEndpoint,
  accessKeyId: accessKeyId,
  secretAccessKey: secretAccessKey,
  region: region,
  s3ForcePathStyle: true,
  signatureVersion: 'v4',
  // Force credentials to be passed explicitly
  credentials: {
    accessKeyId: accessKeyId!,
    secretAccessKey: secretAccessKey!
  }
});

export interface UploadResult {
  url: string;
  key: string;
  bucket: string;
  size: number;
  contentType: string;
}

export interface UploadOptions {
  folder?: string;
  contentType?: string;
  metadata?: { [key: string]: string };
  acl?: 'private' | 'public-read' | 'public-read-write';
}

// URL cache to avoid regenerating signed URLs
const urlCache = new Map<string, { url: string; expiresAt: number }>();

export class WasabiStorageService {
  
  /**
   * Upload a file buffer to Wasabi storage
   */
  static async uploadFile(
    buffer: Buffer,
    originalFileName: string,
    options: UploadOptions = {}
  ): Promise<UploadResult> {
    try {
      const {
        folder = 'uploads',
        contentType = 'application/octet-stream',
        metadata = {},
        acl = 'private'
      } = options;

      // Generate unique file name
      const fileExtension = path.extname(originalFileName);
      const fileName = `${uuidv4()}${fileExtension}`;
      const key = `${folder}/${fileName}`;

      // Sanitize metadata to ensure valid HTTP header values
      const sanitizeMetadata = (obj: { [key: string]: string }): { [key: string]: string } => {
        const sanitized: { [key: string]: string } = {};
        for (const [key, value] of Object.entries(obj)) {
          // Remove invalid characters from keys and values
          const sanitizedKey = key.replace(/[^\w-]/g, '').toLowerCase();
          const sanitizedValue = String(value).replace(/[^\w\s.-]/g, '').trim();
          if (sanitizedKey && sanitizedValue) {
            sanitized[sanitizedKey] = sanitizedValue;
          }
        }
        return sanitized;
      };

      const sanitizedMetadata = sanitizeMetadata({
        'original-filename': originalFileName,
        'upload-timestamp': new Date().toISOString(),
        ...metadata
      });

      const uploadParams: AWS.S3.PutObjectRequest = {
        Bucket: wasabiBucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
        ACL: acl,
        Metadata: sanitizedMetadata
      };

      console.log(`Uploading file to Wasabi: ${key}`);
      console.log('Sanitized metadata:', sanitizedMetadata);
      const result = await s3.upload(uploadParams).promise();

      return {
        url: result.Location,
        key: result.Key,
        bucket: result.Bucket,
        size: buffer.length,
        contentType
      };

    } catch (error) {
      console.error('Wasabi upload error:', error);
      throw new Error(`Failed to upload file to Wasabi: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Upload image file (2D analysis)
   */
  static async uploadImage(
    buffer: Buffer,
    originalFileName: string,
    metadata: { [key: string]: string } = {}
  ): Promise<UploadResult> {
    const contentType = this.getImageContentType(originalFileName);
    
    return this.uploadFile(buffer, originalFileName, {
      folder: 'images',
      contentType,
      metadata: {
        'file-type': '2D',
        'category': 'medical-image',
        ...metadata
      },
      acl: 'private'
    });
  }

  /**
   * Upload ZIP file (3D DICOM analysis)
   */
  static async uploadZipFile(
    buffer: Buffer,
    originalFileName: string,
    metadata: { [key: string]: string } = {}
  ): Promise<UploadResult> {
    return this.uploadFile(buffer, originalFileName, {
      folder: 'dicom-zip',
      contentType: 'application/zip',
      metadata: {
        'file-type': '3D',
        'category': 'dicom-archive',
        ...metadata
      },
      acl: 'private'
    });
  }

  /**
   * Upload analysis result file
   */
  static async uploadAnalysisResult(
    buffer: Buffer,
    originalFileName: string,
    analysisType: '2D' | '3D',
    metadata: { [key: string]: string } = {}
  ): Promise<UploadResult> {
    const contentType = originalFileName.endsWith('.json') ? 'application/json' : 'application/octet-stream';
    
    return this.uploadFile(buffer, originalFileName, {
      folder: `analysis-results/${analysisType.toLowerCase()}`,
      contentType,
      metadata: {
        'file-type': analysisType,
        'category': 'analysis-result',
        ...metadata
      },
      acl: 'private'
    });
  }

  /**
   * Generate a pre-signed URL for file download (with caching)
   */
  static async generateDownloadUrl(key: string, expiresIn: number = 3600): Promise<string> {
    try {
      const now = Date.now();
      const cacheKey = `${key}:${expiresIn}`;
      const cached = urlCache.get(cacheKey);
      if (cached && cached.expiresAt > now + 300000) {
        console.log(`✅ Using cached URL for ${key} (expires in ${Math.round((cached.expiresAt - now) / 1000)}s)`);
        return cached.url;
      }

      // Generate new signed URL
      const params = {
        Bucket: wasabiBucket,
        Key: key,
        Expires: expiresIn // URL expires in seconds (default: 1 hour)
      };

      const url = s3.getSignedUrl('getObject', params);
      urlCache.set(cacheKey, {
        url,
        expiresAt: now + (expiresIn * 1000) - 300000
      });
      
      console.log(`🔗 Generated new signed URL for ${key} (expires in ${expiresIn}s)`);
      return url;
    } catch (error) {
      console.error('Error generating download URL:', error);
      throw new Error(`Failed to generate download URL: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Delete a file from Wasabi storage
   */
  static async deleteFile(key: string): Promise<void> {
    try {
      const params = {
        Bucket: wasabiBucket,
        Key: key
      };

      await s3.deleteObject(params).promise();
      console.log(`File deleted from Wasabi: ${key}`);
    } catch (error) {
      console.error('Error deleting file from Wasabi:', error);
      throw new Error(`Failed to delete file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Check if a file exists in Wasabi storage
   */
  static async fileExists(key: string): Promise<boolean> {
    try {
      const params = {
        Bucket: wasabiBucket,
        Key: key
      };

      await s3.headObject(params).promise();
      return true;
    } catch (error) {
      if ((error as AWS.AWSError).statusCode === 404) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Get file metadata
   */
  static async getFileMetadata(key: string): Promise<AWS.S3.HeadObjectOutput> {
    try {
      const params = {
        Bucket: wasabiBucket,
        Key: key
      };

      return await s3.headObject(params).promise();
    } catch (error) {
      console.error('Error getting file metadata:', error);
      throw new Error(`Failed to get file metadata: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * List files in a folder
   */
  static async listFiles(prefix: string = '', maxKeys: number = 1000): Promise<AWS.S3.Object[]> {
    try {
      const params = {
        Bucket: wasabiBucket,
        Prefix: prefix,
        MaxKeys: maxKeys
      };

      const result = await s3.listObjectsV2(params).promise();
      return result.Contents || [];
    } catch (error) {
      console.error('Error listing files:', error);
      throw new Error(`Failed to list files: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get appropriate content type for image files
   */
  private static getImageContentType(fileName: string): string {
    const ext = path.extname(fileName).toLowerCase();
    switch (ext) {
      case '.jpg':
      case '.jpeg':
        return 'image/jpeg';
      case '.png':
        return 'image/png';
      case '.gif':
        return 'image/gif';
      case '.bmp':
        return 'image/bmp';
      case '.webp':
        return 'image/webp';
      default:
        return 'image/jpeg'; // Default fallback
    }
  }

  /**
   * Validate storage configuration
   */
  static validateConfiguration(): boolean {
    const requiredEnvVars = [
      'WASABI_ACCESS_KEY_ID',
      'WASABI_SECRET_ACCESS_KEY',
      'WASABI_BUCKET_NAME'
    ];

    const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
    
    if (missingVars.length > 0) {
      console.error('Missing required Wasabi configuration:', missingVars);
      console.error('Current environment variables:');
      console.error('WASABI_ACCESS_KEY_ID:', process.env.WASABI_ACCESS_KEY_ID ? 'SET' : 'MISSING');
      console.error('WASABI_SECRET_ACCESS_KEY:', process.env.WASABI_SECRET_ACCESS_KEY ? 'SET' : 'MISSING');
      console.error('WASABI_BUCKET_NAME:', process.env.WASABI_BUCKET_NAME || 'MISSING');
      console.error('WASABI_REGION:', process.env.WASABI_REGION || 'us-east-1');
      console.error('WASABI_ENDPOINT:', process.env.WASABI_ENDPOINT || 'https://s3.wasabisys.com');
      return false;
    }

    console.log('✅ Wasabi configuration validated successfully');
    console.log('Bucket:', process.env.WASABI_BUCKET_NAME);
    console.log('Region:', process.env.WASABI_REGION || 'us-east-1');
    console.log('Endpoint:', process.env.WASABI_ENDPOINT || 'https://s3.wasabisys.com');
    return true;
  }

  /**
   * Test connection to Wasabi
   */
  static async testConnection(): Promise<boolean> {
    try {
      await s3.listObjectsV2({ Bucket: wasabiBucket, MaxKeys: 1 }).promise();
      console.log('✅ Wasabi connection successful');
      return true;
    } catch (error) {
      console.error('❌ Wasabi connection failed:', error);
      return false;
    }
  }
}

export default WasabiStorageService;

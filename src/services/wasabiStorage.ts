import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand, ListObjectsV2Command, S3ClientConfig } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

// Wasabi Storage Configuration
// For India/Asia: Use ap-southeast-1 (Singapore) - FASTEST
// For US: Use us-east-2 (Ohio) or us-east-1 (Virginia)
// For Europe: Use eu-central-1 (Amsterdam)
const wasabiEndpoint = process.env.WASABI_ENDPOINT || 'https://s3.wasabisys.com';
const wasabiBucket = process.env.WASABI_BUCKET_NAME || 'ai-diagnosis-storage';
const accessKeyId = process.env.WASABI_ACCESS_KEY_ID;
const secretAccessKey = process.env.WASABI_SECRET_ACCESS_KEY;
const region = process.env.WASABI_REGION || 'ap-southeast-1'; // Default to Asia Pacific for better global performance

if (!accessKeyId || !secretAccessKey) {
  console.error('Missing Wasabi credentials:');
  console.error('WASABI_ACCESS_KEY_ID:', accessKeyId ? 'SET' : 'MISSING');
  console.error('WASABI_SECRET_ACCESS_KEY:', secretAccessKey ? 'SET' : 'MISSING');
  console.error('WASABI_BUCKET_NAME:', wasabiBucket);
  console.error('WASABI_REGION:', region);
  console.error('WASABI_ENDPOINT:', wasabiEndpoint);
}

const s3ClientConfig: S3ClientConfig = {
  endpoint: wasabiEndpoint,
  region: region,
  credentials: {
    accessKeyId: accessKeyId!,
    secretAccessKey: secretAccessKey!
  },
  forcePathStyle: true,
  // Performance optimizations for faster downloads
  requestHandler: {
    requestTimeout: 30 * 60 * 1000, // 30 minutes for large files
  },
  // Retry configuration for better reliability
  maxAttempts: 3,
  retryMode: 'adaptive' as const,
};

const s3Client = new S3Client(s3ClientConfig);

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

      const command = new PutObjectCommand({
        Bucket: wasabiBucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
        Metadata: sanitizedMetadata
      });

      console.log(`Uploading file to Wasabi: ${key}`);
      console.log('Sanitized metadata:', sanitizedMetadata);
      console.log(`File size: ${(buffer.length / (1024 * 1024)).toFixed(2)} MB`);
      
      const startTime = Date.now();
      await s3Client.send(command);
      const uploadTime = ((Date.now() - startTime) / 1000).toFixed(2);
      
      console.log(`✅ File uploaded to Wasabi successfully in ${uploadTime}s: ${key}`);

      return {
        url: `${wasabiEndpoint}/${wasabiBucket}/${key}`,
        key: key,
        bucket: wasabiBucket,
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
   * @param key - S3 object key
   * @param expiresIn - Expiration time in seconds (default: 1 hour, can be up to 7 days for large files)
   */
  static async generateDownloadUrl(key: string, expiresIn: number = 3600): Promise<string> {
    // Cap expiration at 7 days (604800 seconds) as per S3/Wasabi limits
    const maxExpiration = 7 * 24 * 60 * 60; // 7 days
    expiresIn = Math.min(expiresIn, maxExpiration);
    try {
      const now = Date.now();
      const cacheKey = `${key}:${expiresIn}`;
      const cached = urlCache.get(cacheKey);
      if (cached && cached.expiresAt > now + 300000) {
        console.log(`✅ Using cached URL for ${key} (expires in ${Math.round((cached.expiresAt - now) / 1000)}s)`);
        return cached.url;
      }

      const command = new GetObjectCommand({
        Bucket: wasabiBucket,
        Key: key,
        // Add response headers for better download performance
        ResponseContentDisposition: `attachment; filename="${path.basename(key)}"`,
        ResponseCacheControl: 'public, max-age=3600', // Cache for 1 hour
      });

      const url = await getSignedUrl(s3Client, command, { expiresIn });
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
      const command = new DeleteObjectCommand({
        Bucket: wasabiBucket,
        Key: key
      });

      await s3Client.send(command);
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
      const command = new HeadObjectCommand({
        Bucket: wasabiBucket,
        Key: key
      });

      await s3Client.send(command);
      return true;
    } catch (error: any) {
      if (error.$metadata?.httpStatusCode === 404) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Get file metadata
   */
  static async getFileMetadata(key: string) {
    try {
      const command = new HeadObjectCommand({
        Bucket: wasabiBucket,
        Key: key
      });

      return await s3Client.send(command);
    } catch (error) {
      console.error('Error getting file metadata:', error);
      throw new Error(`Failed to get file metadata: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * List files in a folder
   */
  static async listFiles(prefix: string = '', maxKeys: number = 1000): Promise<any[]> {
    try {
      const command = new ListObjectsV2Command({
        Bucket: wasabiBucket,
        Prefix: prefix,
        MaxKeys: maxKeys
      });

      const result = await s3Client.send(command);
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
      const command = new ListObjectsV2Command({ 
        Bucket: wasabiBucket, 
        MaxKeys: 1 
      });
      await s3Client.send(command);
      console.log('✅ Wasabi connection successful');
      return true;
    } catch (error) {
      console.error('❌ Wasabi connection failed:', error);
      return false;
    }
  }
}

export default WasabiStorageService;

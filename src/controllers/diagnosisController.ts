import { Request, Response, NextFunction } from 'express';
import { Patient } from '../models/Patient';
import { Diagnosis } from '../models/Diagnosis';
import { createError } from '../middleware/errorHandler';
import OpenAI from 'openai';
import fs from "fs";
import { AssemblyAI } from 'assemblyai';



export const transcribe = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  let filePath: string | undefined;
  
  try {
    // Validate OpenAI API key
    if (!process.env.OPENAI_API_KEY) {
      res.status(500).json({ 
        success: false,
        error: "OpenAI API key not configured" 
      });
      return;
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    filePath = req.file?.path;

    if (!filePath) {
      res.status(400).json({ 
        success: false,
        error: "No audio file uploaded" 
      });
      return;
    }

    // Check if file exists and has content
    const stats = fs.statSync(filePath);
    if (stats.size === 0) {
      res.status(400).json({ 
        success: false,
        error: "Uploaded file is empty" 
      });
      return;
    }

    // Log for debugging
    const fileExtension = filePath.split('.').pop()?.toLowerCase();
    console.log(`Processing audio file for translation to English: ${filePath}, size: ${stats.size} bytes, extension: ${fileExtension}`);
    console.log('Input: Any language (Hindi, Kannada, English, etc.) → Output: English only');
    
    // Additional validation for minimum file size
    if (stats.size < 100) {
      res.status(400).json({ 
        success: false,
        error: "Audio file too small - may be corrupted or contain no audio data" 
      });
      return;
    }

    // Validate file extension
    const supportedFormats = ['flac', 'm4a', 'mp3', 'mp4', 'mpeg', 'mpga', 'oga', 'ogg', 'wav', 'webm'];
    if (!fileExtension || !supportedFormats.includes(fileExtension)) {
      res.status(400).json({ 
        success: false,
        error: `Unsupported file format: ${fileExtension}. Supported formats: ${supportedFormats.join(', ')}` 
      });
      return;
    }

    // Use translations.create to convert all languages (Hindi, Kannada, etc.) to English
    // This allows multilingual input but ensures English-only output for the UI
    const response = await client.audio.translations.create({
      file: fs.createReadStream(filePath),
      model: "whisper-1",
      response_format: "text" // Translates Hindi/Kannada/other languages to English
      // Supports 99+ input languages, always outputs in English
    });

    // Clean up temp file
    fs.unlinkSync(filePath);

    // Validate response
    if (!response || typeof response !== 'string') {
      res.status(500).json({ 
        success: false,
        error: "Invalid response from transcription service" 
      });
      return;
    }

    const transcriptText = (response as string).trim() || "";
    
    res.json({ 
      success: true,
      text: transcriptText,
      message: transcriptText ? "Transcription successful" : "No speech detected"
    });

  } catch (err: any) {
    // Clean up temp file on error
    if (filePath && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (cleanupErr) {
        console.error("Failed to cleanup temp file:", cleanupErr);
      }
    }

    console.error("Transcription error:", err);
    
    // Handle specific OpenAI errors
    if (err.status === 400) {
      console.error('OpenAI 400 Error Details:', err.error || err.message);
      res.status(400).json({ 
        success: false,
        error: `Audio processing failed: ${err.error?.message || 'Invalid audio format or corrupted file'}` 
      });
    } else if (err.status === 429) {
      res.status(429).json({ 
        success: false,
        error: "Rate limit exceeded. Please try again later." 
      });
    } else if (err.status === 401) {
      res.status(500).json({ 
        success: false,
        error: "OpenAI API authentication failed" 
      });
    } else if (err.code === 'ENOENT') {
      res.status(400).json({ 
        success: false,
        error: "Audio file not found or corrupted during upload" 
      });
    } else {
      console.error('Unexpected transcription error:', err);
      res.status(500).json({ 
        success: false,
        error: `Transcription failed: ${err.message || 'Unknown error'}` 
      });
    }
  }
};

export const transcribeWithSpeakers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  let filePath: string | undefined;
  
  try {
    // Validate both API keys
    if (!process.env.ASSEMBLY_API_KEY) {
      res.status(500).json({ 
        success: false,
        error: "Assembly AI API key not configured" 
      });
      return;
    }

    if (!process.env.OPENAI_API_KEY) {
      res.status(500).json({ 
        success: false,
        error: "OpenAI API key not configured" 
      });
      return;
    }

    const assemblyClient = new AssemblyAI({
      apiKey: process.env.ASSEMBLY_API_KEY!
    });

    const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    filePath = req.file?.path;

    if (!filePath) {
      res.status(400).json({ 
        success: false,
        error: "No audio file uploaded" 
      });
      return;
    }

    // Check if file exists and has content
    const stats = fs.statSync(filePath);
    if (stats.size === 0) {
      res.status(400).json({ 
        success: false,
        error: "Uploaded file is empty" 
      });
      return;
    }

    // Log for debugging
    const fileExtension = filePath.split('.').pop()?.toLowerCase();
    console.log(`Processing audio with Whisper (transcription) + Assembly AI (speakers): ${filePath}, size: ${stats.size} bytes, extension: ${fileExtension}`);
    
    // Additional validation for minimum file size
    if (stats.size < 1000) {
      res.status(400).json({ 
        success: false,
        error: "Audio file too small - may be corrupted or contain no audio data" 
      });
      return;
    }

    // Validate file extension
    const supportedFormats = ['flac', 'm4a', 'mp3', 'mp4', 'mpeg', 'mpga', 'oga', 'ogg', 'wav', 'webm'];
    if (!fileExtension || !supportedFormats.includes(fileExtension)) {
      res.status(400).json({ 
        success: false,
        error: `Unsupported file format: ${fileExtension}. Supported formats: ${supportedFormats.join(', ')}` 
      });
      return;
    }

    console.log('Starting parallel processing: OpenAI Whisper (multilingual input → English output) + Assembly AI (speaker detection)...');
    console.log('File size:', stats.size, 'bytes');
    console.log('File extension:', fileExtension);
    console.log('Language support: Understands Hindi, English, Kannada (99+ input languages) → Always outputs English');
    console.log('Assembly AI API Key configured:', !!process.env.ASSEMBLY_API_KEY);
    console.log('OpenAI API Key configured:', !!process.env.OPENAI_API_KEY);

    // Process both in parallel for better performance
    const [assemblyResult, openaiResult] = await Promise.allSettled([
      // Assembly AI for speaker diarization ONLY (no transcription needed)
      (async () => {
        const uploadUrl = await assemblyClient.files.upload(filePath);
        const config = {
          audio_url: uploadUrl,
          speaker_labels: true,
          // Remove problematic parameters that cause "Invalid endpoint schema" error
          punctuate: true,
          format_text: true,
          dual_channel: false,
          // Assembly AI supports multiple languages but primarily English
          // For Hindi/Kannada, Whisper will handle transcription, Assembly AI just for speaker detection
          language_detection: true // Enable automatic language detection
        };
        
        console.log('Assembly AI config being sent:', JSON.stringify(config, null, 2));
        return await assemblyClient.transcripts.transcribe(config);
      })(),
      
      // OpenAI Whisper for high-quality translation to English (from Hindi, Kannada, etc.)
      (async () => {
        return await openaiClient.audio.translations.create({
          file: fs.createReadStream(filePath),
          model: "whisper-1",
          response_format: "text"
          // Translates any input language (Hindi, Kannada, etc.) to English output
          // Supports 99+ input languages, always outputs in English
        });
      })()
    ]);

    // Clean up temp file
    fs.unlinkSync(filePath);

    // Handle results
    let speakerSegments: any[] = [];
    let transcriptText = "";

    // Process OpenAI result (for high-quality English transcription)
    if (openaiResult.status === 'fulfilled' && openaiResult.value) {
      transcriptText = (openaiResult.value as any).toString().trim() || "";
      console.log('✅ OpenAI Whisper transcription successful:', transcriptText.length, 'characters');
    } else {
      console.error('❌ OpenAI transcription failed:', openaiResult.status === 'rejected' ? openaiResult.reason : 'Unknown error');
    }

    // Process Assembly AI result (for speaker diarization ONLY)
    if (assemblyResult.status === 'fulfilled' && assemblyResult.value) {
      const assemblyTranscript = assemblyResult.value;
      console.log('🎤 Assembly AI Status:', assemblyTranscript.status);
      console.log('🎤 Assembly AI Error:', assemblyTranscript.error);
      console.log('🎤 Assembly AI Utterances:', assemblyTranscript.utterances?.length || 0);
      
      if (assemblyTranscript.status === 'completed' && assemblyTranscript.utterances) {
        let rawSegments = assemblyTranscript.utterances.map(utterance => ({
          speaker: utterance.speaker,
          text: utterance.text, // We'll replace this with aligned Whisper text
          start: utterance.start,
          end: utterance.end,
          confidence: utterance.confidence
        }));

        // Optimize speaker segments and align with Whisper transcription
        speakerSegments = optimizeSpeakerSegments(rawSegments);
        console.log('✅ Assembly AI speaker detection successful:', speakerSegments.length, 'segments');
      } else {
        console.error('❌ Assembly AI speaker detection failed:', assemblyTranscript.error || 'No utterances found');
      }
    } else {
      console.error('❌ Assembly AI processing failed:', assemblyResult.status === 'rejected' ? assemblyResult.reason : 'Unknown error');
    }

    // Combine results: Use Whisper transcription quality with Assembly AI speaker timing
    if (transcriptText && speakerSegments.length > 0) {
      // Align OpenAI Whisper text with Assembly AI speaker segments
      const alignedSpeakers = alignWhisperWithSpeakers(transcriptText, speakerSegments);
      
      res.json({ 
        success: true,
        text: transcriptText, // High-quality Whisper translation to English
        speakers: alignedSpeakers, // Speaker timing from Assembly AI with English text from Whisper
        message: `Hybrid success! Whisper translation (multilingual→English) with ${[...new Set(alignedSpeakers.map(s => s.speaker))].length} speaker(s) detected by Assembly AI`
      });
    } else if (transcriptText) {
      // Fallback: Whisper transcription only (no speaker detection)
      res.json({ 
        success: true,
        text: transcriptText,
        speakers: [],
        message: "Whisper transcription successful, but speaker detection failed"
      });
    } else if (speakerSegments.length > 0) {
      // Fallback: Assembly AI only (shouldn't happen often)
      const assemblyText = speakerSegments.map(s => s.text).join(' ');
      res.json({ 
        success: true,
        text: assemblyText,
        speakers: speakerSegments,
        message: "Speaker detection successful, but Whisper transcription failed"
      });
    } else {
      res.status(500).json({ 
        success: false,
        error: "Both Whisper transcription and Assembly AI speaker detection failed"
      });
    }

  } catch (err: any) {
    // Clean up temp file on error
    if (filePath && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (cleanupErr) {
        console.error("Failed to cleanup temp file:", cleanupErr);
      }
    }

    console.error("Hybrid transcription error:", err);
    
    // Handle specific errors
    if (err.status === 400) {
      res.status(400).json({ 
        success: false,
        error: `Audio processing failed: ${err.message || 'Invalid audio format or corrupted file'}` 
      });
    } else if (err.status === 401) {
      res.status(500).json({ 
        success: false,
        error: "API authentication failed (OpenAI or Assembly AI)" 
      });
    } else if (err.status === 429) {
      res.status(429).json({ 
        success: false,
        error: "Rate limit exceeded. Please try again later." 
      });
    } else {
      console.error('Unexpected hybrid transcription error:', err);
      res.status(500).json({ 
        success: false,
        error: `Transcription failed: ${err.message || 'Unknown error'}` 
      });
    }
  }
};

// Helper function to optimize speaker segments for better accuracy
const optimizeSpeakerSegments = (segments: any[]) => {
  if (!segments || segments.length === 0) return [];

  // Sort segments by start time
  const sortedSegments = [...segments].sort((a, b) => a.start - b.start);
  const optimizedSegments: any[] = [];
  
  for (let i = 0; i < sortedSegments.length; i++) {
    const currentSegment = sortedSegments[i];
    
    // Skip very short segments (likely noise or false detection)
    if (currentSegment.text.trim().length < 5) { // Increased threshold
      continue;
    }
    
    // Check if this segment should be merged with the previous one
    const lastSegment = optimizedSegments[optimizedSegments.length - 1];
    
    if (lastSegment && shouldMergeSegments(lastSegment, currentSegment)) {
      // Merge with previous segment
      lastSegment.text += ' ' + currentSegment.text;
      lastSegment.end = currentSegment.end;
      lastSegment.confidence = Math.max(lastSegment.confidence, currentSegment.confidence);
    } else {
      // Add as new segment
      optimizedSegments.push({
        ...currentSegment,
        // Normalize speaker labels to be more consistent
        speaker: normalizeSpeakerLabel(currentSegment.speaker)
      });
    }
  }

  // Advanced voice-based analysis to detect single speaker scenarios
  const voiceAnalysis = analyzeVoicePatterns(optimizedSegments);
  
  if (voiceAnalysis.isSingleSpeaker) {
    console.log(`Voice analysis detected single speaker: ${voiceAnalysis.reason}`);
    return optimizedSegments.map(segment => ({
      ...segment,
      speaker: voiceAnalysis.primarySpeaker,
      singleSpeakerDetected: true
    }));
  }

  return optimizedSegments;
};

// Helper function to determine if segments should be merged
const shouldMergeSegments = (prev: any, current: any) => {
  const timeDiff = current.start - prev.end;
  const sameSpeaker = prev.speaker === current.speaker;
  const shortGap = timeDiff < 3000; // Increased to 3 seconds gap
  const reasonableConfidence = prev.confidence > 0.6 && current.confidence > 0.6; // Lowered threshold
  
  // Also merge if different speakers but very short gap (likely same person)
  const veryShortGap = timeDiff < 1000; // Less than 1 second
  const differentSpeakers = prev.speaker !== current.speaker;
  const likelySamePerson = differentSpeakers && veryShortGap && reasonableConfidence;
  
  return (sameSpeaker && shortGap && reasonableConfidence) || likelySamePerson;
};

// Advanced voice pattern analysis to detect single speaker scenarios
const analyzeVoicePatterns = (segments: any[]) => {
  if (!segments || segments.length < 2) {
    return { isSingleSpeaker: false, primarySpeaker: 'A', reason: 'Insufficient data' };
  }

  const speakerCounts = segments.reduce((counts, segment) => {
    counts[segment.speaker] = (counts[segment.speaker] || 0) + 1;
    return counts;
  }, {});
  
  const speakers = Object.keys(speakerCounts);
  const totalSegments = segments.length;
  
  // Analysis 1: Speaker dominance (one speaker has 80%+ of segments)
  const majorSpeaker = speakers.find(speaker => 
    speakerCounts[speaker] / totalSegments > 0.8
  );
  
  if (majorSpeaker) {
    return {
      isSingleSpeaker: true,
      primarySpeaker: majorSpeaker,
      reason: `Dominance pattern: ${speakerCounts[majorSpeaker]}/${totalSegments} segments (${Math.round(speakerCounts[majorSpeaker]/totalSegments*100)}%)`
    };
  }

  // Analysis 2: Rapid alternations (< 1.5 seconds between different speakers)
  let rapidAlternations = 0;
  let totalAlternations = 0;
  
  for (let i = 1; i < segments.length; i++) {
    const prev = segments[i-1];
    const curr = segments[i];
    
    if (prev.speaker !== curr.speaker) {
      totalAlternations++;
      const gap = curr.start - prev.end;
      if (gap < 1500) { // Less than 1.5 seconds
        rapidAlternations++;
      }
    }
  }
  
  if (totalAlternations > 0 && rapidAlternations / totalAlternations > 0.7) {
    return {
      isSingleSpeaker: true,
      primarySpeaker: speakers[0],
      reason: `Rapid alternations: ${rapidAlternations}/${totalAlternations} speaker changes < 1.5s (${Math.round(rapidAlternations/totalAlternations*100)}%)`
    };
  }

  // Analysis 3: Confidence pattern (low confidence often indicates false speaker detection)
  const avgConfidenceBySpeaker: {[key: string]: number} = {};
  for (const speaker of speakers) {
    const speakerSegments = segments.filter(s => s.speaker === speaker);
    const avgConfidence = speakerSegments.reduce((sum, s) => sum + s.confidence, 0) / speakerSegments.length;
    avgConfidenceBySpeaker[speaker] = avgConfidence;
  }
  
  // If one speaker has much lower confidence, it's likely a false detection
  const confidenceValues = Object.values(avgConfidenceBySpeaker);
  const maxConfidence = Math.max(...confidenceValues);
  const minConfidence = Math.min(...confidenceValues);
  
  if (speakers.length === 2 && (maxConfidence - minConfidence) > 0.15) {
    const highConfidenceSpeaker = Object.keys(avgConfidenceBySpeaker).find(
      speaker => avgConfidenceBySpeaker[speaker] === maxConfidence
    );
    
    return {
      isSingleSpeaker: true,
      primarySpeaker: highConfidenceSpeaker,
      reason: `Confidence disparity: ${highConfidenceSpeaker}(${maxConfidence.toFixed(2)}) vs others(${minConfidence.toFixed(2)})`
    };
  }

  // Analysis 4: Segment length pattern (very short segments often indicate false detection)
  const shortSegments = segments.filter(s => s.text.trim().length < 10).length;
  if (shortSegments / totalSegments > 0.4) {
    return {
      isSingleSpeaker: true,
      primarySpeaker: speakers[0],
      reason: `Too many short segments: ${shortSegments}/${totalSegments} (${Math.round(shortSegments/totalSegments*100)}%)`
    };
  }

  return { isSingleSpeaker: false, primarySpeaker: 'A', reason: 'Multiple speakers detected' };
};

// Helper function to normalize speaker labels
const normalizeSpeakerLabel = (speaker: string) => {
  // Convert to consistent format (A, B, C, etc.)
  if (speaker.toLowerCase().includes('a') || speaker === '0') return 'A';
  if (speaker.toLowerCase().includes('b') || speaker === '1') return 'B';
  if (speaker.toLowerCase().includes('c') || speaker === '2') return 'C';
  
  // Default mapping
  return speaker.toUpperCase();
};

// Helper function to align Whisper transcription with Assembly AI speaker segments
const alignWhisperWithSpeakers = (whisperText: string, assemblySegments: any[]) => {
  if (!whisperText || !assemblySegments || assemblySegments.length === 0) {
    return assemblySegments;
  }

  console.log('🔄 Aligning Whisper text with speaker segments...');
  console.log('📝 Whisper text:', whisperText);
  console.log('🎤 Assembly segments:', assemblySegments.length);

  // If only one speaker segment, use the entire Whisper text
  if (assemblySegments.length === 1) {
    console.log('📌 Single speaker detected - using full Whisper translation');
    return [{
      ...assemblySegments[0],
      text: whisperText.trim(), // Use the complete English translation
      whisperBased: true,
      assemblyAI: true
    }];
  }

  // For multiple segments, we need to intelligently split the Whisper text
  // based on timing proportions and sentence boundaries
  const words = whisperText.trim().split(/\s+/);
  const totalDuration = Math.max(...assemblySegments.map(s => s.end)) - Math.min(...assemblySegments.map(s => s.start));
  
  let wordIndex = 0;
  const alignedSegments = assemblySegments.map((segment, index) => {
    const segmentDuration = segment.end - segment.start;
    const segmentProportion = segmentDuration / totalDuration;
    
    // Calculate how many words this segment should get based on duration
    const wordsForSegment = Math.max(1, Math.round(words.length * segmentProportion));
    
    // Extract words for this segment
    const segmentWords = words.slice(wordIndex, wordIndex + wordsForSegment);
    wordIndex += segmentWords.length;
    
    // If this is the last segment, give it all remaining words
    if (index === assemblySegments.length - 1 && wordIndex < words.length) {
      segmentWords.push(...words.slice(wordIndex));
    }
    
    const segmentText = segmentWords.join(' ');
    
    console.log(`🎯 Segment ${index + 1}: Speaker ${segment.speaker} → "${segmentText}"`);
    
    return {
      ...segment,
      text: segmentText, // Use proportionally allocated English text
      whisperBased: true,
      assemblyAI: true
    };
  });

  return alignedSegments;
};

// Mock OpenAI function - replace with actual OpenAI SDK
const analyzeConversationWithOpenAI = async (conversationText: string): Promise<{
  symptoms: string[];
  diagnosis: string;
  confidence: number;
  summary: string;
}> => {
  try {
    // TODO: Replace with actual OpenAI API call
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: `You are a medical AI assistant. Your task is to analyze the provided doctor-patient conversation and return the findings strictly in JSON format. 
      
      Instructions:
      1. Extract and list all symptoms mentioned in the conversation.
      2. If the doctor provides a diagnosis in the conversation, capture it exactly as stated. 
         - If no diagnosis is explicitly provided by the doctor, generate AI-suggested possible diagnoses based on the symptoms.
      3. Write a brief, concise summary of the conversation.
      
      Output JSON structure:
      {
        "symptoms": [ "symptom1", "symptom2", ... ],
        "possible_diagnosis": "single diagnosis as string",
        "summary": "One or two sentence summary."
      }
      
      Rules:
      - Only return valid JSON, no extra text or explanations.
      - If doctor’s diagnosis is given, do not overwrite or alter it, just record it.`
        },
        {
          role: "user",
          content: conversationText
        }
      ]
      
    });

    const responseContent = completion.choices[0].message.content;
    if (!responseContent) {
      throw new Error('No response from OpenAI');
    }

    const analysis = JSON.parse(responseContent);
    
    // Validate and provide fallbacks for required fields
    let diagnosisString = 'Diagnosis pending further analysis';
    
    if (analysis.possible_diagnosis) {
      if (Array.isArray(analysis.possible_diagnosis)) {
        diagnosisString = analysis.possible_diagnosis.join(', ');
      } else if (typeof analysis.possible_diagnosis === 'string') {
        diagnosisString = analysis.possible_diagnosis;
      }
    }
    
    return {
      symptoms: Array.isArray(analysis.symptoms) ? analysis.symptoms : ['Symptoms not clearly identified'],
      diagnosis: diagnosisString,
      confidence: typeof analysis.confidence === 'number' ? Math.max(0, Math.min(100, analysis.confidence)) : 50,
      summary: analysis.summary || 'Analysis completed but summary not available'
    };
  } catch (error) {
    console.error('OpenAI analysis failed:', error);
    
    // Return fallback data if OpenAI fails
    return {
      symptoms: ['Analysis failed - manual review required'],
      diagnosis: 'Diagnosis pending - AI analysis unavailable',
      confidence: 0,
      summary: 'AI analysis service temporarily unavailable. Please review manually.'
    };
  }
};

export const analyzeConversation = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { patientId, conversationText } = req.body;

    if (!patientId || !conversationText) {
      res.status(400).json({
        success: false,
        message: 'Patient ID and conversation text are required'
      });
      return;
    }

    // Verify patient exists
    const patient = await Patient.findById(patientId);
    if (!patient) {
      res.status(404).json({
        success: false,
        message: 'Patient not found'
      });
      return;
    }

    // Analyze conversation with OpenAI
    const analysis = await analyzeConversationWithOpenAI(conversationText);
    console.log('AI Analysis result:', analysis);
    
    // Validate analysis result before creating diagnosis
    if (!analysis.diagnosis || typeof analysis.diagnosis !== 'string' || !analysis.symptoms || analysis.symptoms.length === 0) {
      res.status(500).json({
        success: false,
        message: 'AI analysis failed to provide valid diagnosis or symptoms',
        data: {
          analysis: analysis
        }
      });
      return;
    }
    
    // Create diagnosis record
    const diagnosis = new Diagnosis({
      patient: patientId,
      conversationText,
      symptoms: analysis.symptoms,
      diagnosis: analysis.diagnosis,
      confidence: analysis.confidence,
      doctor: req.user?.email || 'AI System'
    });

    await diagnosis.save();

    res.status(200).json({
      success: true,
      message: 'Conversation analyzed successfully',
      data: {
        analysis: analysis,
        diagnosisId: diagnosis._id,
        patient: {
          id: patient._id,
          name: patient.name,
          age: patient.age,
          gender: patient.gender
        }
      }
    });
  } catch (error: any) {
    console.error('Error in analyzeConversation:', error);
    
    // Handle specific validation errors
    if (error.name === 'ValidationError') {
      res.status(400).json({
        success: false,
        message: 'Validation error in diagnosis creation',
        error: error.message
      });
      return;
    }
    
    // Handle other errors
    res.status(500).json({
      success: false,
      message: 'Internal server error during analysis',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
    });
  }
};

export const getDiagnosisHistory = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { patientId } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    // Verify patient exists
    const patient = await Patient.findById(patientId);
    if (!patient) {
      res.status(404).json({
        success: false,
        message: 'Patient not found'
      });
      return;
    }

    const diagnoses = await Diagnosis.find({ patient: patientId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Diagnosis.countDocuments({ patient: patientId });

    res.status(200).json({
      success: true,
      data: {
        patient: {
          id: patient._id,
          name: patient.name,
          age: patient.age,
          gender: patient.gender
        },
        diagnoses,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

export const getDiagnosisById = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;

    const diagnosis = await Diagnosis.findById(id);
    if (!diagnosis) {
      res.status(404).json({
        success: false,
        message: 'Diagnosis not found'
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: { diagnosis }
    });
  } catch (error) {
    next(error);
  }
};

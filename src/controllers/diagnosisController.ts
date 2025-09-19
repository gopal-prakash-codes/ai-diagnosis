import { Request, Response, NextFunction } from 'express';
import { Patient } from '../models/Patient';
import { Diagnosis } from '../models/Diagnosis';
import { createError } from '../middleware/errorHandler';
import OpenAI from 'openai';
import fs from "fs";
import { AssemblyAI } from 'assemblyai';
import crypto from 'crypto';

export const transcribe = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  let filePath: string | undefined;

  try {
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

    const stats = fs.statSync(filePath);
    if (stats.size === 0) {
      res.status(400).json({
        success: false,
        error: "Uploaded file is empty"
      });
      return;
    }

    const fileExtension = filePath.split('.').pop()?.toLowerCase();

    if (stats.size < 100) {
      res.status(400).json({
        success: false,
        error: "Audio file too small - may be corrupted or contain no audio data"
      });
      return;
    }

    const supportedFormats = ['flac', 'm4a', 'mp3', 'mp4', 'mpeg', 'mpga', 'oga', 'ogg', 'wav', 'webm'];
    if (!fileExtension || !supportedFormats.includes(fileExtension)) {
      res.status(400).json({
        success: false,
        error: `Unsupported file format: ${fileExtension}. Supported formats: ${supportedFormats.join(', ')}`
      });
      return;
    }

    const response = await client.audio.translations.create({
      file: fs.createReadStream(filePath),
      model: "whisper-1",
      response_format: "text"
    });

    fs.unlinkSync(filePath);

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
    if (filePath && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (cleanupErr) {
        console.error("Failed to cleanup temp file:", cleanupErr);
      }
    }

    if (err.status === 400) {
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

    const stats = fs.statSync(filePath);
    if (stats.size === 0) {
      res.status(400).json({
        success: false,
        error: "Uploaded file is empty"
      });
      return;
    }

    const fileExtension = filePath.split('.').pop()?.toLowerCase();

    if (stats.size < 1000) {
      res.status(400).json({
        success: false,
        error: "Audio file too small - may be corrupted or contain no audio data"
      });
      return;
    }

    const supportedFormats = ['flac', 'm4a', 'mp3', 'mp4', 'mpeg', 'mpga', 'oga', 'ogg', 'wav', 'webm'];
    if (!fileExtension || !supportedFormats.includes(fileExtension)) {
      res.status(400).json({
        success: false,
        error: `Unsupported file format: ${fileExtension}. Supported formats: ${supportedFormats.join(', ')}`
      });
      return;
    }

    console.log('🚀 Starting parallel processing:', {
      fileExists: fs.existsSync(filePath),
      fileSize: stats.size,
      fileExtension: fileExtension,
      assemblyApiKey: !!process.env.ASSEMBLY_API_KEY,
      openaiApiKey: !!process.env.OPENAI_API_KEY
    });

    const [assemblyResult, openaiResult] = await Promise.allSettled([
      (async () => {
        console.log('🎤 Assembly AI: Starting upload...');
        const uploadUrl = await assemblyClient.files.upload(filePath);
        console.log('🎤 Assembly AI: Upload successful, starting transcription...');
        const config = {
          audio_url: uploadUrl,
          speaker_labels: true,
          speakers_expected: 2,
          punctuate: true,
          format_text: true,
          dual_channel: false,
          language_detection: false,
          auto_highlights: false,
          disfluencies: false,
          filter_profanity: false
        };

        return await assemblyClient.transcripts.transcribe(config);
      })(),

      (async () => {
        console.log('🎤 OpenAI Whisper: Starting translation...');
        try {
          const result = await openaiClient.audio.translations.create({
            file: fs.createReadStream(filePath),
            model: "whisper-1",
            response_format: "text"
          });
          console.log('🎤 OpenAI Whisper: Translation completed successfully');
          return result;
        } catch (error: any) {
          console.error('🎤 OpenAI Whisper: Translation failed with error:', {
            message: error?.message || 'Unknown error',
            status: error?.status || null,
            code: error?.code || null,
            type: error?.type || null,
            fullError: error
          });
          throw error;
        }
      })()
    ]);

    fs.unlinkSync(filePath);

    let speakerSegments: any[] = [];
    let transcriptText = "";

    if (openaiResult.status === 'fulfilled' && openaiResult.value) {
      transcriptText = (openaiResult.value as any).toString().trim() || "";
      console.log('✅ OpenAI Whisper SUCCESS:', {
        textLength: transcriptText.length,
        preview: transcriptText.substring(0, 100),
        fullText: transcriptText
      });
    } else {
      console.error('❌ OpenAI Whisper FAILED:', {
        status: openaiResult.status,
        reason: openaiResult.status === 'rejected' ? openaiResult.reason : 'Unknown error',
        errorMessage: openaiResult.status === 'rejected' ? openaiResult.reason?.message : null,
        errorCode: openaiResult.status === 'rejected' ? openaiResult.reason?.code : null,
        errorStatus: openaiResult.status === 'rejected' ? openaiResult.reason?.status : null
      });
    }

    if (assemblyResult.status === 'fulfilled' && assemblyResult.value) {
      const assemblyTranscript = assemblyResult.value;

      if (assemblyTranscript.status === 'completed') {
        if (assemblyTranscript.utterances && assemblyTranscript.utterances.length > 0) {
          let rawSegments = assemblyTranscript.utterances.map(utterance => ({
            speaker: utterance.speaker,
            text: utterance.text,
            start: utterance.start,
            end: utterance.end,
            confidence: utterance.confidence
          }));

          const utteranceQuality = validateSpeakerQuality(rawSegments);

          if (utteranceQuality.averageConfidence > 0.7 && rawSegments.length <= 10) {
            speakerSegments = rawSegments.map(segment => ({
              ...segment,
              speaker: normalizeSpeakerLabel(segment.speaker),
              preservedUtterance: true
            }));
          } else {
            speakerSegments = optimizeSpeakerSegments(rawSegments);
          }
        } else {
          if (assemblyTranscript.text && assemblyTranscript.text.trim().length > 0) {
            speakerSegments = [{
              speaker: 'A',
              text: assemblyTranscript.text.trim(),
              start: 0,
              end: 30000,
              confidence: 0.5,
              fallback: true
            }];
          }
        }
      }
    }

    console.log('📊 Final Results Summary:', {
      whisperSuccess: !!transcriptText,
      whisperTextLength: transcriptText?.length || 0,
      assemblySuccess: speakerSegments.length > 0,
      speakerCount: speakerSegments.length,
      usingWhisperText: !!transcriptText,
      fallbackToAssembly: !transcriptText && speakerSegments.length > 0
    });

    if (transcriptText && speakerSegments.length > 0) {
      console.log('✅ HYBRID SUCCESS: Both Whisper and Assembly AI worked');
      const alignedSpeakers = alignWhisperWithSpeakers(transcriptText, speakerSegments);

      res.json({
        success: true,
        text: transcriptText,
        speakers: alignedSpeakers,
        message: `Hybrid success! Whisper translation (multilingual→English) with ${[...new Set(alignedSpeakers.map(s => s.speaker))].length} speaker(s) detected by Assembly AI`
      });
    } else if (transcriptText) {
      console.log('⚠️ WHISPER ONLY: Whisper worked, Assembly AI failed');
      const fallbackSpeakers = createFallbackSpeakerDetection(transcriptText);

      res.json({
        success: true,
        text: transcriptText,
        speakers: fallbackSpeakers,
        message: fallbackSpeakers.length > 0 ?
          `Whisper transcription successful with fallback speaker detection (${fallbackSpeakers.length} segments)` :
          "Whisper transcription successful, but speaker detection failed"
      });
    } else if (speakerSegments.length > 0) {
      console.log('⚠️ ASSEMBLY ONLY: Assembly AI worked, Whisper failed');
      const assemblyText = speakerSegments.map(s => s.text).join(' ');
      res.json({
        success: true,
        text: assemblyText,
        speakers: speakerSegments,
        message: "Speaker detection successful, but Whisper transcription failed"
      });
    } else {
      console.log('❌ TOTAL FAILURE: Both services failed');
      res.status(500).json({
        success: false,
        error: "Both Whisper transcription and Assembly AI speaker detection failed"
      });
    }

  } catch (err: any) {
    if (filePath && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (cleanupErr) {
        console.error("Failed to cleanup temp file:", cleanupErr);
      }
    }

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
      res.status(500).json({
        success: false,
        error: `Transcription failed: ${err.message || 'Unknown error'}`
      });
    }
  }
};

const createFallbackSpeakerDetection = (text: string) => {
  if (!text || text.trim().length < 10) {
    return [];
  }

  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 5);

  if (sentences.length <= 1) {
    return [{
      speaker: 'A',
      text: text.trim(),
      start: 0,
      end: Math.max(5000, text.length * 100),
      confidence: 0.3,
      fallback: true,
      method: 'single-sentence'
    }];
  }

  const segments: any[] = [];
  let currentTime = 0;

  sentences.forEach((sentence, index) => {
    const cleanSentence = sentence.trim();
    if (cleanSentence.length < 3) return;

    const speaker = index % 2 === 0 ? 'A' : 'B';
    const duration = Math.max(2000, cleanSentence.length * 80);

    segments.push({
      speaker: speaker,
      text: cleanSentence,
      start: currentTime,
      end: currentTime + duration,
      confidence: 0.4,
      fallback: true,
      method: 'sentence-alternation'
    });

    currentTime += duration + 500;
  });

  return segments;
};

const validateSpeakerQuality = (segments: any[]) => {
  if (!segments || segments.length === 0) {
    return { averageConfidence: 0, hasHighConfidenceSegments: false, speakerCount: 0 };
  }

  const confidences = segments.map(s => s.confidence || 0);
  const averageConfidence = confidences.reduce((sum, conf) => sum + conf, 0) / confidences.length;
  const hasHighConfidenceSegments = segments.some(s => s.confidence > 0.8);
  const uniqueSpeakers = [...new Set(segments.map(s => s.speaker))];

  return {
    averageConfidence: Math.round(averageConfidence * 100) / 100,
    hasHighConfidenceSegments,
    speakerCount: uniqueSpeakers.length,
    highConfidenceCount: segments.filter(s => s.confidence > 0.8).length,
    lowConfidenceCount: segments.filter(s => s.confidence < 0.5).length
  };
};

const optimizeSpeakerSegments = (segments: any[]) => {
  if (!segments || segments.length === 0) return [];
  const sortedSegments = [...segments].sort((a, b) => a.start - b.start);
  const optimizedSegments: any[] = [];

  const speakerValidation = validateSpeakerQuality(sortedSegments);

  for (let i = 0; i < sortedSegments.length; i++) {
    const currentSegment = sortedSegments[i];
    if (currentSegment.text.trim().length < 5) {
      continue;
    }

    if (currentSegment.confidence < 0.5 && speakerValidation.hasHighConfidenceSegments) {
      continue;
    }

    const lastSegment = optimizedSegments[optimizedSegments.length - 1];

    if (lastSegment && shouldMergeSegments(lastSegment, currentSegment)) {
      lastSegment.text += ' ' + currentSegment.text;
      lastSegment.end = currentSegment.end;
      lastSegment.confidence = Math.max(lastSegment.confidence, currentSegment.confidence);
    } else {
      const normalizedSegment = {
        ...currentSegment,
        speaker: normalizeSpeakerLabel(currentSegment.speaker)
      };
      optimizedSegments.push(normalizedSegment);
    }
  }

  if (speakerValidation.averageConfidence > 0.6) {
    const voiceAnalysis = analyzeVoicePatterns(optimizedSegments);

    if (voiceAnalysis.isSingleSpeaker) {
      return optimizedSegments.map(segment => ({
        ...segment,
        speaker: voiceAnalysis.primarySpeaker,
        singleSpeakerDetected: true
      }));
    }
  }

  return optimizedSegments;
};

const shouldMergeSegments = (prev: any, current: any) => {
  const timeDiff = current.start - prev.end;
  const sameSpeaker = prev.speaker === current.speaker;
  const shortGap = timeDiff < 2000;
  const reasonableConfidence = prev.confidence > 0.7 && current.confidence > 0.7;

  const veryShortGap = timeDiff < 500;
  const differentSpeakers = prev.speaker !== current.speaker;
  const highConfidence = prev.confidence > 0.8 && current.confidence > 0.8;
  const likelySamePerson = differentSpeakers && veryShortGap && highConfidence;

  return (sameSpeaker && shortGap && reasonableConfidence) || likelySamePerson;
};

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

  const majorSpeaker = speakers.find(speaker =>
    speakerCounts[speaker] / totalSegments > 0.95
  );

  if (majorSpeaker) {
    return {
      isSingleSpeaker: true,
      primarySpeaker: majorSpeaker,
      reason: `Dominance pattern: ${speakerCounts[majorSpeaker]}/${totalSegments} segments (${Math.round(speakerCounts[majorSpeaker] / totalSegments * 100)}%)`
    };
  }

  let rapidAlternations = 0;
  let totalAlternations = 0;

  for (let i = 1; i < segments.length; i++) {
    const prev = segments[i - 1];
    const curr = segments[i];

    if (prev.speaker !== curr.speaker) {
      totalAlternations++;
      const gap = curr.start - prev.end;
      if (gap < 1500) {
        rapidAlternations++;
      }
    }
  }

  if (totalAlternations > 0 && rapidAlternations / totalAlternations > 0.85) {
    return {
      isSingleSpeaker: true,
      primarySpeaker: speakers[0],
      reason: `Rapid alternations: ${rapidAlternations}/${totalAlternations} speaker changes < 1.5s (${Math.round(rapidAlternations / totalAlternations * 100)}%)`
    };
  }

  const avgConfidenceBySpeaker: { [key: string]: number } = {};
  for (const speaker of speakers) {
    const speakerSegments = segments.filter(s => s.speaker === speaker);
    const avgConfidence = speakerSegments.reduce((sum, s) => sum + s.confidence, 0) / speakerSegments.length;
    avgConfidenceBySpeaker[speaker] = avgConfidence;
  }

  const confidenceValues = Object.values(avgConfidenceBySpeaker);
  const maxConfidence = Math.max(...confidenceValues);
  const minConfidence = Math.min(...confidenceValues);

  if (speakers.length === 2 && (maxConfidence - minConfidence) > 0.25) {
    const highConfidenceSpeaker = Object.keys(avgConfidenceBySpeaker).find(
      speaker => avgConfidenceBySpeaker[speaker] === maxConfidence
    );

    return {
      isSingleSpeaker: true,
      primarySpeaker: highConfidenceSpeaker,
      reason: `Confidence disparity: ${highConfidenceSpeaker}(${maxConfidence.toFixed(2)}) vs others(${minConfidence.toFixed(2)})`
    };
  }

  const shortSegments = segments.filter(s => s.text.trim().length < 10).length;
  if (shortSegments / totalSegments > 0.6) {
    return {
      isSingleSpeaker: true,
      primarySpeaker: speakers[0],
      reason: `Too many short segments: ${shortSegments}/${totalSegments} (${Math.round(shortSegments / totalSegments * 100)}%)`
    };
  }

  return { isSingleSpeaker: false, primarySpeaker: 'A', reason: 'Multiple speakers detected' };
};

const createConversationHash = (conversationText: string): string => {
  const normalizedContent = conversationText
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
  
  return crypto.createHash('sha256').update(normalizedContent).digest('hex').substring(0, 16);
};

const isConversationExtension = (previousConversation: string, newConversation: string): boolean => {
  if (!previousConversation || !newConversation) {
    return false;
  }
  const normalizedPrevious = previousConversation.trim().replace(/\s+/g, ' ');
  const normalizedNew = newConversation.trim().replace(/\s+/g, ' ');
  if (normalizedNew.length <= normalizedPrevious.length) {
    return false;
  }
  const similarity = normalizedNew.includes(normalizedPrevious) || 
                    normalizedNew.startsWith(normalizedPrevious.substring(0, Math.min(200, normalizedPrevious.length)));
  
  return similarity;
};


const normalizeSpeakerLabel = (speaker: string) => {
  if (speaker.toLowerCase().includes('a') || speaker === '0') return 'A';
  if (speaker.toLowerCase().includes('b') || speaker === '1') return 'B';

  return speaker.toUpperCase();
};

const alignWhisperWithSpeakers = (whisperText: string, assemblySegments: any[]) => {
  if (!whisperText || !assemblySegments || assemblySegments.length === 0) {
    return assemblySegments;
  }

  if (assemblySegments.length === 1) {
    return [{
      ...assemblySegments[0],
      text: whisperText.trim(),
      whisperBased: true,
      assemblyAI: true
    }];
  }

  const alignedSegments = intelligentTextAlignment(whisperText, assemblySegments);

  return alignedSegments;
};

const detectPatientMonologue = (text: string, segments: any[]) => {
  const lowerText = text.toLowerCase();

  const patientIndicators = [
    'doctor, i am having', 'hello doctor', 'i am having', 'i have been having',
    'since the last night', 'i am feeling', 'my stomach', 'headache',
    'i do not have taken', 'my medical history', 'seizures',
    'bloating', 'weakness', 'pain', 'fever', 'stomach ache'
  ];

  const patientScore = patientIndicators.filter(indicator =>
    lowerText.includes(indicator)
  ).length;

  const doctorIndicators = [
    'can you', 'what are', 'how long', 'when did', 'let me',
    'please tell me', 'describe', 'any other symptoms', 'examination'
  ];

  const doctorScore = doctorIndicators.filter(indicator =>
    lowerText.includes(indicator)
  ).length;

  const startsWithPatient = lowerText.startsWith('doctor,') ||
    lowerText.startsWith('hello doctor') ||
    lowerText.startsWith('i am having') ||
    lowerText.startsWith('i have been');

  const isMonologue = patientScore >= 2 &&
    patientScore > doctorScore &&
    startsWithPatient &&
    segments.length > 3;

  return isMonologue;
};

const intelligentTextAlignment = (whisperText: string, assemblySegments: any[]) => {
  const whisperSentences = whisperText
    .split(/[.!?]+/)
    .map(s => s.trim())
    .filter(s => s.length > 3);

  const isPatientMonologue = detectPatientMonologue(whisperText, assemblySegments);
  if (isPatientMonologue) {
    return [{
      ...assemblySegments[0],
      speaker: 'B',
      text: whisperText.trim(),
      start: Math.min(...assemblySegments.map(s => s.start)),
      end: Math.max(...assemblySegments.map(s => s.end)),
      confidence: assemblySegments.reduce((sum, s) => sum + s.confidence, 0) / assemblySegments.length,
      whisperBased: true,
      assemblyAI: true,
      mappingMethod: 'patient-monologue'
    }];
  }

  if (whisperSentences.length === assemblySegments.length) {
    return assemblySegments.map((segment, index) => ({
      ...segment,
      text: whisperSentences[index],
      whisperBased: true,
      assemblyAI: true,
      mappingMethod: 'one-to-one'
    }));
  }

  if (whisperSentences.length > assemblySegments.length) {
    const sentencesPerUtterance = Math.ceil(whisperSentences.length / assemblySegments.length);

    return assemblySegments.map((segment, index) => {
      const startIdx = index * sentencesPerUtterance;
      const endIdx = Math.min(startIdx + sentencesPerUtterance, whisperSentences.length);
      const combinedText = whisperSentences.slice(startIdx, endIdx).join('. ');

      return {
        ...segment,
        text: combinedText + (combinedText.endsWith('.') ? '' : '.'),
        whisperBased: true,
        assemblyAI: true,
        mappingMethod: 'sentence-grouping'
      };
    });
  }

  if (whisperSentences.length < assemblySegments.length) {
    return contentBasedAlignment(whisperText, whisperSentences, assemblySegments);
  }

  return assemblySegments.map(segment => ({
    ...segment,
    whisperBased: false,
    assemblyAI: true,
    mappingMethod: 'assembly-fallback'
  }));
};

const contentBasedAlignment = (fullWhisperText: string, whisperSentences: string[], assemblySegments: any[]) => {
  const words = fullWhisperText.trim().split(/\s+/);
  const totalDuration = Math.max(...assemblySegments.map(s => s.end)) - Math.min(...assemblySegments.map(s => s.start));

  let wordIndex = 0;
  return assemblySegments.map((segment, index) => {
    const segmentDuration = segment.end - segment.start;
    const segmentProportion = segmentDuration / totalDuration;

    const wordsForSegment = Math.max(1, Math.round(words.length * segmentProportion));
    const segmentWords = words.slice(wordIndex, wordIndex + wordsForSegment);
    wordIndex += segmentWords.length;

    if (index === assemblySegments.length - 1 && wordIndex < words.length) {
      segmentWords.push(...words.slice(wordIndex));
    }

    const segmentText = segmentWords.join(' ');

    return {
      ...segment,
      text: segmentText,
      whisperBased: true,
      assemblyAI: true,
      mappingMethod: 'content-proportional'
    };
  });
};

const analyzeConversationWithOpenAI = async (
  conversationText: string, 
  previousDiagnosis?: any
): Promise<{
  symptoms: string[];
  allergies: string[];
  diagnosis: string;
  diagnosisData: Array<{ condition: string, confidence: number }>;
  treatment: string;
  confidence: number;
  summary: string;
}> => {
  if (!process.env.OPENAI_API_KEY) {
    console.error('OpenAI API key is not configured');
    return {
      symptoms: ['Configuration error - OpenAI API key missing'],
      allergies: [],
      diagnosis: 'System configuration error - unable to analyze',
      diagnosisData: [{ condition: 'System configuration error', confidence: 0 }],
      treatment: 'System configuration required',
      confidence: 0,
      summary: 'OpenAI API key not configured in environment variables.'
    };
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const modelsToTry = ["gpt-4", "gpt-4-turbo", "gpt-3.5-turbo"];
  const conversationHash = createConversationHash(conversationText);
  
  
  const seed = parseInt(conversationHash.substring(0, 8), 16) % 1000000;
  
  for (const model of modelsToTry) {
    try {
      console.log(`Attempting to use model: ${model} with seed: ${seed}`);
      const completion = await openai.chat.completions.create({
        model: model,
        temperature: 0.0, 
        top_p: 0.1, 
        frequency_penalty: 0, 
        presence_penalty: 0, 
        seed: seed, 
        max_tokens: 2000, 
        messages: [
        {
          role: "system",
          content: `You are a medical AI assistant. Analyze the doctor-patient conversation and return findings in JSON format.

CORE RULES:
- Extract all current symptoms mentioned in the conversation
- Extract all allergies mentioned by patient or identified by doctor (medications, foods, environmental)
- If doctor provides diagnosis, use it exactly as stated with high confidence, if doctor do not provide any diagnosis provide the possible diagnosis based on the symptoms and the conversation.
- If diagnosis is ruled out by tests/doctor, suggest alternative diagnoses based on symptoms
- Always provide at least one possible diagnosis unless no symptoms are present
- Use consistent medical terminology

ALLERGIES EXTRACTION:
- Only include allergies explicitly mentioned in the conversation
- Include medication allergies (e.g., "allergic to penicillin", "cannot take aspirin")
- Include food allergies (e.g., "allergic to peanuts", "lactose intolerant")
- Include environmental allergies (e.g., "allergic to pollen", "dust allergy")
- If no allergies mentioned, return empty array []
- Do not assume or infer allergies that are not explicitly stated

ELIMINATION HANDLING:
- If previous diagnosis is ruled out by tests/examination, suggest alternative diagnoses for the same symptoms
- Example: "Anemia ruled out by normal hemoglobin" → suggest other causes of fatigue/weakness
- NEVER return empty diagnosis list - always provide alternative possibilities
- Update treatment for new suspected conditions

CONFIDENCE SCORING:
- 10-30: Very unlikely but possible
- 40-60: Moderate likelihood  
- 70-90: Highly likely
- 95+: Confirmed by tests or doctor

JSON FORMAT:
{
  "symptoms": ["symptom1", "symptom2"],
  "allergies": ["allergy1", "allergy2"],
  "possible_diagnosis": [{"condition": "name", "confidence": 85}],
  "possible_treatment": "treatment recommendation",
  "overall_confidence": 85,
  "summary": "consultation summary"
}

IMPORTANT: Always include at least one condition in possible_diagnosis unless no symptoms exist. Even when conditions are ruled out, suggest alternative diagnoses for the remaining symptoms.

Return only valid JSON.
`},
        {
          role: "user",
          content: previousDiagnosis ? 
            `PREVIOUS MEDICAL CONSULTATION CONTEXT:
Previous symptoms identified: ${previousDiagnosis.symptoms?.join(', ') || 'None'}
Previous diagnosis: ${previousDiagnosis.diagnosis || 'None'}
Previous confidence: ${previousDiagnosis.confidence || 'Unknown'}%
Previous treatment plan: ${previousDiagnosis.treatment || 'None'}

CONVERSATION EXTENSION ANALYSIS:
The conversation below is an extension of a previous consultation. You must:

1. COMPARE the new conversation with previous findings
2. IDENTIFY what has changed, been added, or been clarified
3. UPDATE diagnosis based on new information:
   - If test results contradict previous diagnosis → Remove/modify diagnosis
   - If new symptoms appear → Add to symptom list
   - If patient clarifies/corrects previous info → Update accordingly
   - If new information supports previous diagnosis → Increase confidence
   - If treatment shows improvement → Note in summary

4. MAINTAIN continuity while being responsive to new information

FULL EXTENDED CONVERSATION:
${conversationText}

Focus on what's NEW or DIFFERENT from the previous consultation and how it affects the medical assessment.` 
            : conversationText
        }
      ]
    });

    const responseContent = completion.choices[0].message.content;
    if (!responseContent) {
      throw new Error('No response from OpenAI');
    }

    console.log(`Successfully used model: ${model}`);
    const analysis = JSON.parse(responseContent);

    let diagnosisData = [];
    let diagnosisString = 'Diagnosis pending further analysis';

    if (analysis.possible_diagnosis) {
      if (Array.isArray(analysis.possible_diagnosis)) {
        if (analysis.possible_diagnosis.length > 0 && typeof analysis.possible_diagnosis[0] === 'object') {
          diagnosisData = analysis.possible_diagnosis.filter((d: any) => 
            d.confidence && d.confidence > 0
          );
          
          if (diagnosisData.length === 0) {
            diagnosisData = [{ condition: 'Further investigation needed', confidence: 30 }];
          }
          
          diagnosisString = diagnosisData.map((d: any) => d.condition).join(', ');
        } else {
          diagnosisString = analysis.possible_diagnosis.join(', ');
          diagnosisData = analysis.possible_diagnosis.map((d: any) => ({ condition: d, confidence: 50 }));
        }
      } else if (typeof analysis.possible_diagnosis === 'string') {
        diagnosisString = analysis.possible_diagnosis;
        diagnosisData = [{ condition: analysis.possible_diagnosis, confidence: 50 }];
      }
    }

    const result = {
      symptoms: Array.isArray(analysis.symptoms) ? analysis.symptoms : ['Symptoms not clearly identified'],
      allergies: Array.isArray(analysis.allergies) ? analysis.allergies : [],
      diagnosis: diagnosisString,
      diagnosisData: diagnosisData,
      treatment: analysis.possible_treatment || 'Treatment recommendations pending further evaluation',
      confidence: typeof analysis.overall_confidence === 'number' ? Math.max(0, Math.min(100, analysis.overall_confidence)) :
        typeof analysis.confidence === 'number' ? Math.max(0, Math.min(100, analysis.confidence)) : 50,
      summary: analysis.summary || 'Analysis completed but summary not available'
    };

    console.log(`Generated fresh analysis for conversation`);

    return result;
    
    } catch (modelError: any) {
      console.error(`Model ${model} failed:`, {
        message: modelError.message,
        status: modelError.status,
        code: modelError.code,
        type: modelError.type
      });
      
      if (modelError.message?.includes('model') || 
          modelError.message?.includes('does not exist') ||
          modelError.status === 404 || 
          modelError.status === 400) {
        continue; 
      }
      throw modelError;
    }
  }
  console.error(`All models failed. Tried: ${modelsToTry.join(', ')}`);
  return {
    symptoms: ['Analysis failed - manual review required'],
    allergies: [],
    diagnosis: 'Diagnosis pending - AI analysis unavailable',
    diagnosisData: [{ condition: 'Diagnosis pending - AI analysis unavailable', confidence: 0 }],
    treatment: 'Treatment recommendations unavailable - manual review required',
    confidence: 0,
    summary: `AI analysis service temporarily unavailable. Tried models: ${modelsToTry.join(', ')}. Please review manually.`
  };
};

export const analyzeConversation = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { patientId, conversationText, updateExisting } = req.body;

    if (!patientId || !conversationText) {
      res.status(400).json({
        success: false,
        message: 'Patient ID and conversation text are required'
      });
      return;
    }

    const patient = await Patient.findById(patientId);
    if (!patient) {
      res.status(404).json({
        success: false,
        message: 'Patient not found'
      });
      return;
    }

    const exactMatch = await Diagnosis.findOne({
      patient: patientId,
      conversationText: conversationText
    }).sort({ createdAt: -1 });

    if (exactMatch) {
      console.log(`Found identical conversation, returning existing diagnosis ID: ${exactMatch._id}`);
      res.status(200).json({
        success: true,
        message: 'Using existing diagnosis for identical conversation',
        data: {
          analysis: {
            symptoms: exactMatch.symptoms,
            diagnosis: exactMatch.diagnosis,
            diagnosisData: [{ condition: exactMatch.diagnosis, confidence: exactMatch.confidence || 50 }],
            treatment: exactMatch.treatment || 'Treatment recommendations pending',
            confidence: exactMatch.confidence || 50,
            summary: `Using existing analysis for identical conversation. Diagnosis: ${exactMatch.diagnosis}`
          },
          diagnosisId: exactMatch._id,
          patient: {
            id: patient._id,
            name: patient.name,
            age: patient.age,
            gender: patient.gender
          }
        }
      });
      return;
    }

    let previousDiagnosis = null;
    if (updateExisting) {
      const recentDiagnosis = await Diagnosis.findOne({ 
        patient: patientId 
      }).sort({ createdAt: -1 });
      
      if (recentDiagnosis) {
        previousDiagnosis = {
          symptoms: recentDiagnosis.symptoms,
          diagnosis: recentDiagnosis.diagnosis,
          confidence: recentDiagnosis.confidence,
          treatment: recentDiagnosis.treatment,
          previousConversation: recentDiagnosis.conversationText
        };
        
        console.log(`Using previous diagnosis context for conversation extension:`, {
          previousSymptoms: recentDiagnosis.symptoms,
          previousDiagnosis: recentDiagnosis.diagnosis,
          previousConfidence: recentDiagnosis.confidence
        });
      }
    }

    const analysis = await analyzeConversationWithOpenAI(conversationText, previousDiagnosis);

    if (typeof analysis.diagnosis !== 'string' || !analysis.symptoms || analysis.symptoms.length === 0) {
      res.status(500).json({
        success: false,
        message: 'AI analysis failed to provide valid diagnosis or symptoms',
        data: {
          analysis: analysis
        }
      });
      return;
    }

    let diagnosis;
    if (updateExisting) {
      const recentDiagnosis = await Diagnosis.findOne({ 
        patient: patientId 
      }).sort({ createdAt: -1 });
      
      if (recentDiagnosis && isConversationExtension(recentDiagnosis.conversationText, conversationText)) {
        diagnosis = await Diagnosis.findByIdAndUpdate(
          recentDiagnosis._id,
          {
            conversationText,
            symptoms: analysis.symptoms,
            allergies: analysis.allergies,
            diagnosis: analysis.diagnosis,
            treatment: analysis.treatment,
            confidence: analysis.confidence,
            doctor: req.user?.email || 'AI System',
            updatedAt: new Date()
          },
          { new: true }
        );
      } else {
        diagnosis = new Diagnosis({
          patient: patientId,
          conversationText,
          symptoms: analysis.symptoms,
          allergies: analysis.allergies,
          diagnosis: analysis.diagnosis,
          treatment: analysis.treatment,
          confidence: analysis.confidence,
          doctor: req.user?.email || 'AI System'
        });
        await diagnosis.save();
      }
    } else {
      diagnosis = new Diagnosis({
        patient: patientId,
        conversationText,
        symptoms: analysis.symptoms,
        allergies: analysis.allergies,
        diagnosis: analysis.diagnosis,
        treatment: analysis.treatment,
        confidence: analysis.confidence,
        doctor: req.user?.email || 'AI System'
      });
      await diagnosis.save();
    }

    if (!diagnosis) {
      res.status(500).json({
        success: false,
        message: 'Failed to create or update diagnosis record'
      });
      return;
    }

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
    if (error.name === 'ValidationError') {
      res.status(400).json({
        success: false,
        message: 'Validation error in diagnosis creation',
        error: error.message
      });
      return;
    }

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

import { Request, Response, NextFunction } from 'express';
import { Patient } from '../models/Patient';
import { Diagnosis } from '../models/Diagnosis';
import { createError } from '../middleware/errorHandler';
import OpenAI from 'openai';

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

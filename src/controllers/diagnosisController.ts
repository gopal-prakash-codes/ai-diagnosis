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
  // TODO: Replace with actual OpenAI API call
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const completion = await openai.chat.completions.create({
    model: "gpt-4",
    messages: [{
      role: "system",
      content: "You are a medical AI assistant. Analyze the doctor-patient conversation and provide: 1) List of symptoms mentioned, 2) Possible diagnosis, 3) Confidence level (0-100), 4) Brief summary. Return as JSON."
    }, {
      role: "user",
      content: conversationText
    }]
  });

  // For now, return mock data
  return JSON.parse(completion.choices[0].message.content || '{}');
};

export const analyzeConversation = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { patientId, conversationText } = req.body;

    // if (!patientId || !conversationText) {
    //   res.status(400).json({
    //     success: false,
    //     message: 'Patient ID and conversation text are required'
    //   });
    //   return;
    // }

    // Verify patient exists
    // const patient = await Patient.findById(patientId);
    // if (!patient) {
    //   res.status(404).json({
    //     success: false,
    //     message: 'Patient not found'
    //   });
    //   return;
    // }

    // Analyze conversation with OpenAI
    const analysis = await analyzeConversationWithOpenAI(conversationText);
    console.log(analysis);
    // Create diagnosis record
    // const diagnosis = new Diagnosis({
    //   patient: patientId,
    //   conversationText,
    //   symptoms: analysis.symptoms,
    //   diagnosis: analysis.diagnosis,
    //   confidence: analysis.confidence,
    //   doctor: req.user?.email || 'AI System'
    // });

    // await diagnosis.save();

    res.status(200).json({
      success: true,
      message: 'Conversation analyzed successfully',
      data: {
        analysis: analysis,
        // diagnosisId: diagnosis._id,
        // patient: {
        //   id: patient._id,
        //   name: patient.name,
        //   age: patient.age,
        //   gender: patient.gender
        // }
      }
    });
  } catch (error) {
    next(error);
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

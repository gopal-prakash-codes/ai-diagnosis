import { Request, Response, NextFunction } from 'express';
import { Patient } from '../models/Patient';
import { createError } from '../middleware/errorHandler';
import { getUserFilter } from '../utils/userFilter';

export const createPatient = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { name, age, gender } = req.body;

    if (!req.user!.organization) {
      res.status(400).json({
        success: false,
        message: 'User does not belong to an organization'
      });
      return;
    }

    const patient = new Patient({
      user: req.user!._id,
      organization: req.user!.organization,
      name,
      age,
      gender
    });

    await patient.save();

    res.status(201).json({
      success: true,
      message: 'Patient created successfully',
      data: { patient }
    });
  } catch (error) {
    next(error);
  }
};

export const getAllPatients = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    const search = req.query.search as string;
    const gender = req.query.gender as string;
    
    let query: any = { ...getUserFilter(req) };
    
    if (search) {
      query.name = { $regex: search, $options: 'i' };
    }
    
    if (gender) {
      query.gender = gender;
    }

    const patients = await Patient.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Patient.countDocuments(query);

    res.status(200).json({
      success: true,
      data: {
        patients,
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

export const getPatientById = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const userFilter = getUserFilter(req);

    const patient = await Patient.findOne({ _id: id, ...userFilter });
    if (!patient) {
      res.status(404).json({
        success: false,
        message: 'Patient not found'
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: { patient }
    });
  } catch (error) {
    next(error);
  }
};

export const updatePatient = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const { name, age, gender } = req.body;
    const userFilter = getUserFilter(req);

    const patient = await Patient.findOne({ _id: id, ...userFilter });
    if (!patient) {
      res.status(404).json({
        success: false,
        message: 'Patient not found'
      });
      return;
    }

    // Update fields
    if (name) patient.name = name;
    if (age !== undefined) patient.age = age;
    if (gender) patient.gender = gender;

    await patient.save();

    res.status(200).json({
      success: true,
      message: 'Patient updated successfully',
      data: { patient }
    });
  } catch (error) {
    next(error);
  }
};

export const deletePatient = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const userFilter = getUserFilter(req);

    const patient = await Patient.findOne({ _id: id, ...userFilter });
    if (!patient) {
      res.status(404).json({
        success: false,
        message: 'Patient not found'
      });
      return;
    }

    await Patient.findByIdAndDelete(id);

    res.status(200).json({
      success: true,
      message: 'Patient deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};

export const getPatientStats = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userFilter = getUserFilter(req);
    const totalPatients = await Patient.countDocuments(userFilter);
    
    const genderStats = await Patient.aggregate([
      { $match: userFilter },
      {
        $group: {
          _id: '$gender',
          count: { $sum: 1 }
        }
      }
    ]);

    const ageStats = await Patient.aggregate([
      { $match: userFilter },
      {
        $group: {
          _id: null,
          avgAge: { $avg: '$age' },
          minAge: { $min: '$age' },
          maxAge: { $max: '$age' }
        }
      }
    ]);

    res.status(200).json({
      success: true,
      data: {
        totalPatients,
        genderDistribution: genderStats,
        ageStats: ageStats[0] || { avgAge: 0, minAge: 0, maxAge: 0 }
      }
    });
  } catch (error) {
    next(error);
  }
};

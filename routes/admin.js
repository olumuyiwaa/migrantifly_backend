const express = require('express');
const { User, Application, Document, Payment, Consultation } = require('../models');
const { auth, authorize } = require('../middleware/auth');
const { auditLogger } = require('../middleware/auditLog');

const router = express.Router();

// Dashboard statistics
router.get('/dashboard',
    auth,
    authorize('admin', 'adviser'),
    async (req, res) => {
        try {
            const stats = await Promise.all([
                // Total applications
                Application.countDocuments(),

                // Applications by stage
                Application.aggregate([
                    { $group: { _id: '$stage', count: { $sum: 1 } } }
                ]),

                // Applications by visa type
                Application.aggregate([
                    { $group: { _id: '$visaType', count: { $sum: 1 } } }
                ]),

                // Total revenue
                Payment.aggregate([
                    { $match: { status: 'completed' } },
                    { $group: { _id: null, total: { $sum: '$amount' } } }
                ]),

                // Recent applications
                Application.find()
                    .populate('clientId', 'email profile')
                    .sort({ createdAt: -1 })
                    .limit(10),

                // Pending consultations
                Consultation.countDocuments({ status: 'scheduled' }),

                // Documents pending review
                Document.countDocuments({ status: 'pending' }),

                // Active clients
                User.countDocuments({ role: 'client', isActive: true })
            ]);

            const [
                totalApplications,
                applicationsByStage,
                applicationsByVisaType,
                revenueData,
                recentApplications,
                pendingConsultations,
                pendingDocuments,
                activeClients
            ] = stats;

            const totalRevenue = revenueData[0]?.total || 0;

            res.status(200).json({
                success: true,
                data: {
                    overview: {
                        totalApplications,
                        activeClients,
                        pendingConsultations,
                        pendingDocuments,
                        totalRevenue
                    },
                    applicationsByStage: applicationsByStage.reduce((acc, item) => {
                        acc[item._id] = item.count;
                        return acc;
                    }, {}),
                    applicationsByVisaType: applicationsByVisaType.reduce((acc, item) => {
                        acc[item._id] = item.count;
                        return acc;
                    }, {}),
                    recentApplications
                }
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                message: 'Error fetching dashboard data',
                error: error.message
            });
        }
    }
);

// Get all users
router.get('/users',
    auth,
    authorize('admin'),
    async (req, res) => {
        try {
            const { role, page = 1, limit = 20, search } = req.query;

            const filter = {};
            if (role) filter.role = role;
            if (search) {
                filter.$or = [
                    { email: { $regex: search, $options: 'i' } },
                    { 'profile.firstName': { $regex: search, $options: 'i' } },
                    { 'profile.lastName': { $regex: search, $options: 'i' } }
                ];
            }

            const users = await User.find(filter)
                .select('-password')
                .sort({ createdAt: -1 })
                .limit(limit * 1)
                .skip((page - 1) * limit);

            const total = await User.countDocuments(filter);

            res.status(200).json({
                success: true,
                data: {
                    users,
                    totalPages: Math.ceil(total / limit),
                    currentPage: page,
                    total
                }
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                message: 'Error fetching users',
                error: error.message
            });
        }
    }
);

// Create adviser account
router.post('/create-adviser',
    auth,
    authorize('admin'),
    auditLogger('create_adviser', 'user'),
    async (req, res) => {
        try {
            const { email, password, profile } = req.body;

            // Check if user already exists
            const existingUser = await User.findOne({ email });
            if (existingUser) {
                return res.status(400).json({
                    success: false,
                    message: 'User with this email already exists'
                });
            }

            const adviser = new User({
                email,
                password,
                role: 'adviser',
                profile,
                isEmailVerified: true,
                isActive: true
            });

            await adviser.save();

            // Send welcome email
            const { sendEmail } = require('../utils/email');
            await sendEmail({
                to: email,
                subject: 'Welcome to Migrantifly - Adviser Account Created',
                template: 'adviser-welcome',
                data: {
                    adviserName: `${profile.firstName} ${profile.lastName}`,
                    email,
                    loginUrl: `${process.env.FRONTEND_URL}/login`
                }
            });

            res.status(201).json({
                success: true,
                message: 'Adviser account created successfully',
                data: {
                    id: adviser._id,
                    email: adviser.email,
                    role: adviser.role,
                    profile: adviser.profile
                }
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                message: 'Error creating adviser account',
                error: error.message
            });
        }
    }
);

// Assign adviser to application
router.patch('/applications/:id/assign-adviser',
    auth,
    authorize('admin'),
    auditLogger('assign_adviser', 'application'),
    async (req, res) => {
        try {
            const { adviserId } = req.body;
            const applicationId = req.params.id;

            const application = await Application.findById(applicationId);
            if (!application) {
                return res.status(404).json({
                    success: false,
                    message: 'Application not found'
                });
            }

            const adviser = await User.findOne({ _id: adviserId, role: 'adviser' });
            if (!adviser) {
                return res.status(404).json({
                    success: false,
                    message: 'Adviser not found'
                });
            }

            application.adviserId = adviserId;
            application.timeline.push({
                stage: application.stage,
                date: new Date(),
                notes: `Adviser assigned: ${adviser.profile.firstName} ${adviser.profile.lastName}`,
                updatedBy: req.user._id
            });

            await application.save();

            // Send notification to client
            const { sendNotification } = require('../utils/notifications');
            await sendNotification({
                userId: application.clientId,
                applicationId: application._id,
                type: 'general',
                title: 'Adviser Assigned',
                message: `${adviser.profile.firstName} ${adviser.profile.lastName} has been assigned as your adviser`,
                priority: 'medium'
            });

            res.status(200).json({
                success: true,
                message: 'Adviser assigned successfully',
                data: application
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                message: 'Error assigning adviser',
                error: error.message
            });
        }
    }
);

// System health check
router.get('/system-health',
    auth,
    authorize('admin'),
    async (req, res) => {
        try {
            const mongoose = require('mongoose');

            const health = {
                database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
                uptime: process.uptime(),
                memory: process.memoryUsage(),
                timestamp: new Date().toISOString()
            };

            res.status(200).json({
                success: true,
                data: health
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                message: 'Error checking system health',
                error: error.message
            });
        }
    }
);

module.exports = router;
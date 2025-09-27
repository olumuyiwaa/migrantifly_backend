const express = require('express');
const { Application, Document, Payment, Agreement, Notification } = require('../models');
const { auth, authorize } = require('../middleware/auth');
const { auditLogger } = require('../middleware/auditLog');
const { generateProgressUpdate, calculateProgress } = require('../utils/progressCalculator');
const { sendNotification } = require('../utils/notifications');
const { VISA_TYPES, STAGES } = require('../constants/applicationConstants');

const router = express.Router();

// Get all applications (admin/adviser view)
router.get('/',
    auth,
    authorize('admin', 'adviser'),
    async (req, res) => {
        try {
            const { stage, visaType, page = 1, limit = 20 } = req.query;

            const filter = {};
            if (stage) filter.stage = stage;
            if (visaType) filter.visaType = visaType;

            const applications = await Application.find(filter)
                .populate('clientId', 'email profile')
                .populate('adviserId', 'email profile')
                .sort({ createdAt: -1 })
                .limit(limit * 1)
                .skip((page - 1) * limit);

            const total = await Application.countDocuments(filter);

            res.status(200).json({
                success: true,
                data: {
                    applications,
                    totalPages: Math.ceil(total / limit),
                    currentPage: page,
                    total
                }
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                message: 'Error fetching applications',
                error: error.message
            });
        }
    }
);

// Get client's applications
router.get('/my-applications', auth, async (req, res) => {
    try {
        const applications = await Application.find({ clientId: req.user._id })
            .populate('adviserId', 'email profile')
            .sort({ createdAt: -1 });

        res.status(200).json({
            success: true,
            data: applications
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error fetching applications',
            error: error.message
        });
    }
});

// Create new application
router.post('/',
    auth,
    auditLogger('create', 'application'),
    async (req, res) => {
        try {
            const { visaType, consultationId } = req.body;

            // Check if client already has an active application for this visa type
            const existingApp = await Application.findOne({
                clientId: req.user._id,
                visaType,
                stage: { $nin: ['decision'] }
            });

            if (existingApp) {
                return res.status(400).json({
                    success: false,
                    message: 'You already have an active application for this visa type'
                });
            }

            const application = new Application({
                clientId: req.user._id,
                visaType,
                consultationId,
                stage: 'consultation',
                progress: 10,
                timeline: [{
                    stage: 'consultation',
                    date: new Date(),
                    notes: 'Application created after consultation',
                    updatedBy: req.user._id
                }]
            });

            await application.save();

            // Create initial document checklist
            await createDocumentChecklist(application._id, visaType);

            res.status(201).json({
                success: true,
                message: 'Application created successfully',
                data: application
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                message: 'Error creating application',
                error: error.message
            });
        }
    }
);

// Update application stage
router.patch('/:id/stage',
    auth,
    authorize('admin', 'adviser'),
    auditLogger('update_stage', 'application'),
    async (req, res) => {
        try {
            const { stage, notes } = req.body;
            const applicationId = req.params.id;

            const application = await Application.findById(applicationId);
            if (!application) {
                return res.status(404).json({
                    success: false,
                    message: 'Application not found'
                });
            }

            const oldStage = application.stage;
            application.stage = stage;
            application.progress = calculateProgress(stage);

            // Add to timeline
            application.timeline.push({
                stage,
                date: new Date(),
                notes,
                updatedBy: req.user._id
            });

            await application.save();

            // Send notification to client
            await sendNotification({
                userId: application.clientId,
                applicationId: application._id,
                type: 'stage_updated',
                title: 'Application Stage Updated',
                message: `Your application has been moved to ${stage.replace('_', ' ').toUpperCase()}`,
                priority: 'medium'
            });

            res.status(200).json({
                success: true,
                message: 'Application stage updated successfully',
                data: application
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                message: 'Error updating application stage',
                error: error.message
            });
        }
    }
);

// Submit to INZ
router.patch('/:id/submit-to-inz',
    auth,
    authorize('admin', 'adviser'),
    auditLogger('submit_to_inz', 'application'),
    async (req, res) => {
        try {
            const { inzReference } = req.body;
            const applicationId = req.params.id;

            const application = await Application.findById(applicationId);
            if (!application) {
                return res.status(404).json({
                    success: false,
                    message: 'Application not found'
                });
            }

            // Check if all required documents are approved
            const requiredDocs = await Document.find({
                applicationId,
                isRequired: true,
                status: { $ne: 'approved' }
            });

            if (requiredDocs.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Cannot submit to INZ. Some required documents are not approved.',
                    pendingDocuments: requiredDocs.map(doc => doc.type)
                });
            }

            application.stage = 'submitted_to_inz';
            application.progress = calculateProgress('submitted_to_inz');
            application.inzReference = inzReference;
            application.submissionDate = new Date();

            application.timeline.push({
                stage: 'submitted_to_inz',
                date: new Date(),
                notes: `Application submitted to INZ with reference: ${inzReference}`,
                updatedBy: req.user._id
            });

            await application.save();

            // Send notification to client
            await sendNotification({
                userId: application.clientId,
                applicationId: application._id,
                type: 'stage_updated',
                title: 'Application Submitted to INZ',
                message: `Your application has been submitted to Immigration New Zealand. Reference: ${inzReference}`,
                priority: 'high'
            });

            res.status(200).json({
                success: true,
                message: 'Application submitted to INZ successfully',
                data: application
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                message: 'Error submitting application to INZ',
                error: error.message
            });
        }
    }
);

// Add RFI (Request for Information)
router.post('/:id/rfi',
    auth,
    authorize('admin', 'adviser'),
    auditLogger('add_rfi', 'application'),
    async (req, res) => {
        try {
            const { description, dueDate } = req.body;
            const applicationId = req.params.id;

            const application = await Application.findById(applicationId);
            if (!application) {
                return res.status(404).json({
                    success: false,
                    message: 'Application not found'
                });
            }

            // Add deadline for RFI
            application.deadlines.push({
                type: 'rfi',
                description,
                dueDate: new Date(dueDate),
                completed: false
            });

            application.stage = 'rfi_received';
            application.timeline.push({
                stage: 'rfi_received',
                date: new Date(),
                notes: `RFI received: ${description}`,
                updatedBy: req.user._id
            });

            await application.save();

            // Send urgent notification to client
            await sendNotification({
                userId: application.clientId,
                applicationId: application._id,
                type: 'rfi_received',
                title: 'Request for Information Received',
                message: `INZ has requested additional information. Due date: ${new Date(dueDate).toLocaleDateString()}`,
                priority: 'urgent',
                actionRequired: true
            });

            res.status(200).json({
                success: true,
                message: 'RFI added successfully',
                data: application
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                message: 'Error adding RFI',
                error: error.message
            });
        }
    }
);

// Add PPI (Potentially Prejudicial Information)
router.post('/:id/ppi',
    auth,
    authorize('admin', 'adviser'),
    auditLogger('add_ppi', 'application'),
    async (req, res) => {
        try {
            const { description, dueDate } = req.body;
            const applicationId = req.params.id;

            const application = await Application.findById(applicationId);
            if (!application) {
                return res.status(404).json({
                    success: false,
                    message: 'Application not found'
                });
            }

            // Add deadline for PPI
            application.deadlines.push({
                type: 'ppi',
                description,
                dueDate: new Date(dueDate),
                completed: false
            });

            application.stage = 'ppi_received';
            application.timeline.push({
                stage: 'ppi_received',
                date: new Date(),
                notes: `PPI received: ${description}`,
                updatedBy: req.user._id
            });

            await application.save();

            // Send urgent notification to client
            await sendNotification({
                userId: application.clientId,
                applicationId: application._id,
                type: 'ppi_received',
                title: 'Potentially Prejudicial Information Received',
                message: `INZ has raised concerns that require your response. Due date: ${new Date(dueDate).toLocaleDateString()}`,
                priority: 'urgent',
                actionRequired: true
            });

            res.status(200).json({
                success: true,
                message: 'PPI added successfully',
                data: application
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                message: 'Error adding PPI',
                error: error.message
            });
        }
    }
);

// Record final decision
router.patch('/:id/decision',
    auth,
    authorize('admin', 'adviser'),
    auditLogger('record_decision', 'application'),
    async (req, res) => {
        try {
            const { outcome, decisionLetter, notes } = req.body;
            const applicationId = req.params.id;

            const application = await Application.findById(applicationId);
            if (!application) {
                return res.status(404).json({
                    success: false,
                    message: 'Application not found'
                });
            }

            application.stage = 'decision';
            application.progress = 100;
            application.outcome = outcome;
            application.decisionDate = new Date();
            application.decisionLetter = decisionLetter;

            application.timeline.push({
                stage: 'decision',
                date: new Date(),
                notes: notes || `Application ${outcome}`,
                updatedBy: req.user._id
            });

            await application.save();

            // Send notification to client
            const notificationTitle = outcome === 'approved' ?
                'Congratulations! Your Visa Application is Approved' :
                'Visa Application Decision Received';

            const notificationMessage = outcome === 'approved' ?
                'Your visa application has been approved by INZ. You can download your visa from the portal.' :
                'Your visa application decision is now available. Please check your portal for details.';

            await sendNotification({
                userId: application.clientId,
                applicationId: application._id,
                type: 'decision_received',
                title: notificationTitle,
                message: notificationMessage,
                priority: 'high'
            });

            res.status(200).json({
                success: true,
                message: 'Decision recorded successfully',
                data: application
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                message: 'Error recording decision',
                error: error.message
            });
        }
    }
);

// Get application dashboard data
router.get('/:id/dashboard', auth, async (req, res) => {
    try {
        const applicationId = req.params.id;

        // Check if user has access to this application
        const filter = { _id: applicationId };
        if (req.user.role === 'client') {
            filter.clientId = req.user._id;
        }

        const application = await Application.findOne(filter)
            .populate('clientId', 'email profile')
            .populate('adviserId', 'email profile');

        if (!application) {
            return res.status(404).json({
                success: false,
                message: 'Application not found'
            });
        }

        // Get documents with status
        const documents = await Document.find({ applicationId })
            .select('type name status isRequired reviewNotes');

        // Get pending deadlines
        const pendingDeadlines = application.deadlines
            .filter(deadline => !deadline.completed && new Date(deadline.dueDate) > new Date())
            .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));

        // Get recent notifications
        const notifications = await Notification.find({
            userId: req.user.role === 'client' ? req.user._id : application.clientId,
            applicationId
        })
            .sort({ createdAt: -1 })
            .limit(10);

        // Calculate completion percentage for each stage
        const stageCompletion = calculateStageCompletion(application, documents);

        res.status(200).json({
            success: true,
            data: {
                application,
                documents,
                pendingDeadlines,
                notifications,
                stageCompletion,
                progressBreakdown: getProgressBreakdown(application.stage)
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error fetching dashboard data',
            error: error.message
        });
    }
});

// Helper function to create document checklist based on visa type
async function createDocumentChecklist(applicationId, visaType) {
    const documentTypes = getRequiredDocuments(visaType);

    const documentPromises = documentTypes.map(docType => {
        return Document.create({
            applicationId,
            clientId: null, // Will be set when uploaded
            type: docType.type,
            name: docType.name,
            status: 'pending',
            isRequired: docType.required
        });
    });

    await Promise.all(documentPromises);
}

// Helper function to get required documents by visa type
function getRequiredDocuments(visaType) {
    const commonDocs = [
        { type: 'passport', name: 'Passport Copy', required: true },
        { type: 'photo', name: 'Passport Photos', required: true },
        { type: 'police_clearance', name: 'Police Clearance Certificate', required: true }
    ];

    const visaSpecificDocs = {
        work: [
            { type: 'job_offer', name: 'Job Offer Letter', required: true },
            { type: 'employment_contract', name: 'Employment Contract', required: true },
            { type: 'qualification_documents', name: 'Qualification Documents', required: true }
        ],
        partner: [
            { type: 'marriage_certificate', name: 'Marriage/Partnership Certificate', required: true },
            { type: 'financial_records', name: 'Financial Evidence', required: true }
        ],
        student: [
            { type: 'qualification_documents', name: 'Academic Qualifications', required: true },
            { type: 'financial_records', name: 'Financial Evidence', required: true }
        ],
        residence: [
            { type: 'financial_records', name: 'Financial Evidence', required: true },
            { type: 'medical_certificate', name: 'Medical Certificate', required: true }
        ]
    };

    return [...commonDocs, ...(visaSpecificDocs[visaType] || [])];
}

module.exports = router;

/**
 * @openapi
 * tags:
 *   - name: Applications
 *     description: Application lifecycle operations
 *
 * /api/applications:
 *   get:
 *     tags: [Applications]
 *     summary: List applications (admin/adviser)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: stage
 *         schema: { type: string }
 *       - in: query
 *         name: visaType
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1, minimum: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, minimum: 1, maximum: 100 }
 *     responses:
 *       200: { description: Applications returned }
 *       401: { description: Unauthorized }
 *       403: { description: Forbidden }
 *   post:
 *     tags: [Applications]
 *     summary: Create a new application for current client
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               visaType: { type: string }
 *               consultationId: { type: string }
 *             required: [visaType]
 *     responses:
 *       201: { description: Application created }
 *       400: { description: Already has active application }
 *
 * /api/applications/my-applications:
 *   get:
 *     tags: [Applications]
 *     summary: List current client's applications
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Applications returned }
 *
 * /api/applications/{id}/stage:
 *   patch:
 *     tags: [Applications]
 *     summary: Update application stage (admin/adviser)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               stage: { type: string }
 *               notes: { type: string }
 *             required: [stage]
 *     responses:
 *       200: { description: Stage updated }
 *       404: { description: Application not found }
 *
 * /api/applications/{id}/submit-to-inz:
 *   patch:
 *     tags: [Applications]
 *     summary: Submit application to INZ (admin/adviser)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               inzReference: { type: string }
 *             required: [inzReference]
 *     responses:
 *       200: { description: Submitted to INZ }
 *       400: { description: Pending required documents }
 *
 * /api/applications/{id}/rfi:
 *   post:
 *     tags: [Applications]
 *     summary: Add Request for Information (RFI)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               description: { type: string }
 *               dueDate: { type: string, format: date-time }
 *             required: [description, dueDate]
 *     responses:
 *       200: { description: RFI added }
 *
 * /api/applications/{id}/ppi:
 *   post:
 *     tags: [Applications]
 *     summary: Add Potentially Prejudicial Information (PPI)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               description: { type: string }
 *               dueDate: { type: string, format: date-time }
 *             required: [description, dueDate]
 *     responses:
 *       200: { description: PPI added }
 *
 * /api/applications/{id}/decision:
 *   patch:
 *     tags: [Applications]
 *     summary: Record final decision
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               outcome: { type: string, enum: [approved, declined] }
 *               decisionLetter: { type: string }
 *               notes: { type: string }
 *             required: [outcome]
 *     responses:
 *       200: { description: Decision recorded }
 *
 * /api/applications/{id}/dashboard:
 *   get:
 *     tags: [Applications]
 *     summary: Get application dashboard view
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Dashboard data returned }
 *       404: { description: Application not found }
 *
 * /api/deadlines:
 *   get:
 *     tags: [Deadlines]
 *     summary: List deadlines (adviser/admin)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [overdue, upcoming, completed, all]
 *         description: Filter by status; default excludes completed when not provided
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [rfi, ppi, medical, document]
 *         description: Filter by deadline type
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date
 *         description: Include deadlines due on/after this date (ISO)
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date
 *         description: Include deadlines due on/before this date (ISO)
 *       - in: query
 *         name: completed
 *         schema:
 *           type: boolean
 *         description: If provided, overrides status filter with explicit completed=true/false
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 200
 *           default: 20
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           enum: [dueDate]
 *           default: dueDate
 *       - in: query
 *         name: order
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: asc
 *       - in: query
 *         name: includeSummary
 *         schema:
 *           type: boolean
 *           default: true
 *     responses:
 *       200:
 *         description: Deadlines returned
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DeadlinesResponse'
 *       400: { description: Validation error }
 *       401: { description: Unauthorized }
 *       403: { description: Forbidden }
 *       500: { description: Server error }
 *
 * /api/deadlines/client/{clientId}:
 *   get:
 *     tags: [Deadlines]
 *     summary: List deadlines for a specific client (adviser/admin)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: clientId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [overdue, upcoming, completed, all]
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [rfi, ppi, medical, document]
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: completed
 *         schema: { type: boolean }
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 200, default: 20 }
 *       - in: query
 *         name: sortBy
 *         schema: { type: string, enum: [dueDate], default: dueDate }
 *       - in: query
 *         name: order
 *         schema: { type: string, enum: [asc, desc], default: asc }
 *       - in: query
 *         name: includeSummary
 *         schema: { type: boolean, default: true }
 *     responses:
 *       200:
 *         description: Client deadlines returned
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DeadlinesResponse'
 *       400: { description: Validation error }
 *       401: { description: Unauthorized }
 *       403: { description: Forbidden }
 *       500: { description: Server error }
 *
 * /api/deadlines/me:
 *   get:
 *     tags: [Deadlines]
 *     summary: List deadlines for the authenticated client
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [overdue, upcoming, completed, all]
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [rfi, ppi, medical, document]
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: completed
 *         schema: { type: boolean }
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 200, default: 20 }
 *       - in: query
 *         name: sortBy
 *         schema: { type: string, enum: [dueDate], default: dueDate }
 *       - in: query
 *         name: order
 *         schema: { type: string, enum: [asc, desc], default: asc }
 *       - in: query
 *         name: includeSummary
 *         schema: { type: boolean, default: true }
 *     responses:
 *       200:
 *         description: Client deadlines returned
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DeadlinesResponse'
 *       400: { description: Validation error }
 *       401: { description: Unauthorized }
 *       500: { description: Server error }
 *
 * components:
 *   schemas:
 *     Deadline:
 *       type: object
 *       properties:
 *         type:
 *           type: string
 *           enum: [rfi, ppi, medical, document]
 *         description:
 *           type: string
 *           nullable: true
 *         dueDate:
 *           type: string
 *           format: date-time
 *         completed:
 *           type: boolean
 *     DeadlineItem:
 *       type: object
 *       properties:
 *         applicationId:
 *           type: string
 *         clientId:
 *           type: string
 *         adviserId:
 *           type: string
 *           nullable: true
 *         visaType:
 *           type: string
 *           enum: [work, partner, student, residence, visitor, business]
 *         stage:
 *           type: string
 *           enum:
 *             - consultation
 *             - deposit_paid
 *             - documents_completed
 *             - additional_docs_required
 *             - submitted_to_inz
 *             - inz_processing
 *             - rfi_received
 *             - ppi_received
 *             - decision
 *         deadline:
 *           $ref: '#/components/schemas/Deadline'
 *         overdue:
 *           type: boolean
 *         daysRemaining:
 *           type: integer
 *           description: Days until due date (negative if overdue)
 *     DeadlinesSummary:
 *       type: object
 *       properties:
 *         total: { type: integer }
 *         overdue: { type: integer }
 *         dueToday: { type: integer }
 *         dueSoon: { type: integer }
 *     DeadlinesResponse:
 *       type: object
 *       properties:
 *         page: { type: integer }
 *         limit: { type: integer }
 *         total: { type: integer }
 *         summary:
 *           $ref: '#/components/schemas/DeadlinesSummary'
 *         data:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/DeadlineItem'
 */
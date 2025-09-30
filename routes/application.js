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
          const { stage, visaType, countryCode, page = 1, limit = 20 } = req.query;

          const filter = {};
          if (stage) filter.stage = stage;
          if (visaType) filter.visaType = visaType;
          if (countryCode) filter['destinationCountry.code'] = countryCode.toUpperCase();

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
          const { visaType, consultationId, destinationCountry } = req.body;

          // Validate destination country if provided
          if (destinationCountry && destinationCountry.code) {
              if (!/^[A-Z]{2}$/.test(destinationCountry.code)) {
                  return res.status(400).json({
                      success: false,
                      message: 'Invalid country code format. Must be 2 uppercase letters (e.g., NZ, AU, CA).'
                  });
              }
          }

          // Set default to New Zealand if not provided
          const destination = destinationCountry || { code: 'NZ', name: 'New Zealand' };

          // Check if client already has an active application for this visa type and country
          const existingApp = await Application.findOne({
              clientId: req.user._id,
              visaType,
              'destinationCountry.code': destination.code,
              stage: { $nin: ['decision'] }
          });

          if (existingApp) {
              return res.status(400).json({
                  success: false,
                  message: `You already have an active ${visaType} visa application for ${destination.name}`
              });
          }

          const application = new Application({
              clientId: req.user._id,
              visaType,
              consultationId,
              destinationCountry: destination,
              stage: 'consultation',
              progress: 10,
              timeline: [{
                  stage: 'consultation',
                  date: new Date(),
                  notes: `Application created for ${destination.name} ${visaType} visa`,
                  updatedBy: req.user._id
              }]
          });

          await application.save();

          // Create initial document checklist
          await createDocumentChecklist(application._id, visaType, destination.code);

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

// Submit to Immigration Authority
router.patch('/:id/submit-to-inz',
  auth,
  authorize('admin', 'adviser'),
  auditLogger('submit_to_immigration', 'application'),
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
                  message: 'Cannot submit to immigration authority. Some required documents are not approved.',
                  pendingDocuments: requiredDocs.map(doc => doc.type)
              });
          }

          const countryName = application.destinationCountry?.name || 'Immigration Authority';

          application.stage = 'submitted_to_inz';
          application.progress = calculateProgress('submitted_to_inz');
          application.inzReference = inzReference;
          application.submissionDate = new Date();

          application.timeline.push({
              stage: 'submitted_to_inz',
              date: new Date(),
              notes: `Application submitted to ${countryName} with reference: ${inzReference}`,
              updatedBy: req.user._id
          });

          await application.save();

          // Send notification to client
          await sendNotification({
              userId: application.clientId,
              applicationId: application._id,
              type: 'stage_updated',
              title: `Application Submitted to ${countryName}`,
              message: `Your application has been submitted to ${countryName}. Reference: ${inzReference}`,
              priority: 'high'
          });

          res.status(200).json({
              success: true,
              message: 'Application submitted successfully',
              data: application
          });
      } catch (error) {
          res.status(500).json({
              success: false,
              message: 'Error submitting application',
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

          const countryName = application.destinationCountry?.name || 'Immigration Authority';

          // Send urgent notification to client
          await sendNotification({
              userId: application.clientId,
              applicationId: application._id,
              type: 'rfi_received',
              title: 'Request for Information Received',
              message: `${countryName} has requested additional information. Due date: ${new Date(dueDate).toLocaleDateString()}`,
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

          const countryName = application.destinationCountry?.name || 'Immigration Authority';

          // Send urgent notification to client
          await sendNotification({
              userId: application.clientId,
              applicationId: application._id,
              type: 'ppi_received',
              title: 'Potentially Prejudicial Information Received',
              message: `${countryName} has raised concerns that require your response. Due date: ${new Date(dueDate).toLocaleDateString()}`,
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
            'Your visa application has been approved. You can download your visa from the portal.' :
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

// Helper function to create document checklist based on visa type and country
async function createDocumentChecklist(applicationId, visaType, countryCode = 'NZ') {
    const documentTypes = getRequiredDocuments(visaType, countryCode);

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

// Helper function to get required documents by visa type and country
function getRequiredDocuments(visaType, countryCode = 'NZ') {
    // Common documents across all countries
    const commonDocs = [
        { type: 'passport', name: 'Passport Copy', required: true },
        { type: 'photo', name: 'Passport Photos', required: true }
    ];

    // Country-specific common requirements
    const countrySpecificCommon = {
        'NZ': [
            { type: 'police_clearance', name: 'Police Clearance Certificate', required: true }
        ],
        'AU': [
            { type: 'police_clearance', name: 'Police Clearance Certificate', required: true },
            { type: 'health_examination', name: 'Health Examination', required: true }
        ],
        'CA': [
            { type: 'police_clearance', name: 'Police Certificate', required: true },
            { type: 'biometrics', name: 'Biometrics', required: true }
        ]
    };

    // Visa-specific documents
    const visaSpecificDocs = {
        work: [
            { type: 'job_offer', name: 'Job Offer Letter', required: true },
            { type: 'employment_contract', name: 'Employment Contract', required: true },
            { type: 'qualification_documents', name: 'Qualification Documents', required: true }
        ],
        partner: [
            { type: 'marriage_certificate', name: 'Marriage/Partnership Certificate', required: true },
            { type: 'relationship_evidence', name: 'Relationship Evidence', required: true },
            { type: 'financial_records', name: 'Financial Evidence', required: true }
        ],
        student: [
            { type: 'offer_of_place', name: 'Offer of Place', required: true },
            { type: 'qualification_documents', name: 'Academic Qualifications', required: true },
            { type: 'financial_records', name: 'Financial Evidence', required: true }
        ],
        residence: [
            { type: 'financial_records', name: 'Financial Evidence', required: true },
            { type: 'medical_certificate', name: 'Medical Certificate', required: true },
            { type: 'character_references', name: 'Character References', required: false }
        ],
        visitor: [
            { type: 'travel_itinerary', name: 'Travel Itinerary', required: true },
            { type: 'financial_records', name: 'Financial Evidence', required: true },
            { type: 'accommodation_proof', name: 'Accommodation Proof', required: false }
        ],
        business: [
            { type: 'business_plan', name: 'Business Plan', required: true },
            { type: 'financial_records', name: 'Financial Evidence', required: true },
            { type: 'business_registration', name: 'Business Registration', required: true }
        ]
    };

    const countryDocs = countrySpecificCommon[countryCode] || [];
    const visaDocs = visaSpecificDocs[visaType] || [];

    return [...commonDocs, ...countryDocs, ...visaDocs];
}

// Helper functions (stubs - implement based on your business logic)
function calculateStageCompletion(application, documents) {
    // Implementation for calculating completion of each stage
    return {
        consultation: 100,
        documents: Math.round((documents.filter(d => d.status === 'approved').length / documents.length) * 100),
        submission: application.stage === 'submitted_to_inz' ? 100 : 0,
        decision: application.outcome ? 100 : 0
    };
}

function getProgressBreakdown(stage) {
    // Implementation for getting progress breakdown
    const stages = {
        consultation: { progress: 10, label: 'Initial Consultation' },
        deposit_paid: { progress: 20, label: 'Deposit Paid' },
        documents_completed: { progress: 50, label: 'Documents Completed' },
        submitted_to_inz: { progress: 70, label: 'Submitted to Immigration' },
        inz_processing: { progress: 80, label: 'Processing' },
        decision: { progress: 100, label: 'Decision Received' }
    };
    return stages[stage] || { progress: 0, label: 'Unknown' };
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
 *         description: Filter by application stage
 *       - in: query
 *         name: visaType
 *         schema: { type: string }
 *         description: Filter by visa type
 *       - in: query
 *         name: countryCode
 *         schema: { type: string, pattern: '^[A-Z]{2}$' }
 *         description: Filter by destination country code (e.g., NZ, AU, CA)
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
 *               visaType:
 *                 type: string
 *                 enum: [work, partner, student, residence, visitor, business]
 *               consultationId:
 *                 type: string
 *               destinationCountry:
 *                 type: object
 *                 properties:
 *                   code:
 *                     type: string
 *                     pattern: '^[A-Z]{2}$'
 *                     example: 'NZ'
 *                     description: ISO 3166-1 alpha-2 country code
 *                   name:
 *                     type: string
 *                     example: 'New Zealand'
 *             required: [visaType]
 *     responses:
 *       201: { description: Application created }
 *       400: { description: Invalid data or already has active application }
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
 *     summary: Submit application to immigration authority (admin/adviser)
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
 *       200: { description: Submitted to immigration authority }
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
 */
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { Document, Application, Notification } = require('../models');
const { auth, authorize } = require('../middleware/auth');
const { auditLogger } = require('../middleware/auditLog');
const { uploadToCloudStorage, deleteFromCloudStorage } = require('../utils/fileStorage');
const { sendNotification } = require('../utils/notifications');
const { validateFile, scanForVirus } = require('../utils/fileValidation');

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, '../uploads/temp');
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        // Generate unique filename
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, `${file.fieldname}-${uniqueSuffix}${path.extname(file.originalname)}`);
    }
});

const upload = multer({
    storage,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit
    },
    fileFilter: (req, file, cb) => {
        // Allow specific file types
        const allowedTypes = /jpeg|jpg|png|pdf|doc|docx/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);

        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only JPEG, PNG, PDF, DOC, and DOCX files are allowed.'));
        }
    }
});

// Get documents for an application
router.get('/application/:applicationId', auth, async (req, res) => {
    try {
        const { applicationId } = req.params;

        // Verify user has access to this application
        const application = await Application.findById(applicationId);
        if (!application) {
            return res.status(404).json({
                success: false,
                message: 'Application not found'
            });
        }

        // Check permissions
        if (req.user.role === 'client' && application.clientId.toString() !== req.user._id.toString()) {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }

        const documents = await Document.find({ applicationId })
            .populate('reviewedBy', 'email profile')
            .sort({ createdAt: -1 });

        res.status(200).json({
            success: true,
            data: documents
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error fetching documents',
            error: error.message
        });
    }
});

// Upload document
router.post('/upload',
    auth,
    upload.single('document'),
    auditLogger('upload', 'document'),
    async (req, res) => {
        try {
            const { applicationId, documentType, expiryDate } = req.body;
            const file = req.file;

            if (!file) {
                return res.status(400).json({
                    success: false,
                    message: 'No file uploaded'
                });
            }

            // Verify application exists and user has access
            const application = await Application.findById(applicationId);
            if (!application) {
                // Clean up uploaded file
                await fs.unlink(file.path).catch(() => {});
                return res.status(404).json({
                    success: false,
                    message: 'Application not found'
                });
            }

            if (req.user.role === 'client' && application.clientId.toString() !== req.user._id.toString()) {
                // Clean up uploaded file
                await fs.unlink(file.path).catch(() => {});
                return res.status(403).json({
                    success: false,
                    message: 'Access denied'
                });
            }

            // Validate file
            const validationResult = await validateFile(file.path);
            if (!validationResult.isValid) {
                // Clean up uploaded file
                await fs.unlink(file.path).catch(() => {});
                return res.status(400).json({
                    success: false,
                    message: validationResult.error
                });
            }

            // Scan for viruses (if virus scanner is configured)
            const virusScanResult = await scanForVirus(file.path);
            if (!virusScanResult.isClean) {
                // Clean up uploaded file
                await fs.unlink(file.path).catch(() => {});
                return res.status(400).json({
                    success: false,
                    message: 'File failed security scan'
                });
            }

            // Upload to secure cloud storage
            const fileUrl = await uploadToCloudStorage(file.path, {
                folder: `applications/${applicationId}/documents`,
                filename: `${documentType}-${Date.now()}${path.extname(file.originalname)}`
            });

            // Check if document of this type already exists
            let document = await Document.findOne({
                applicationId,
                type: documentType
            });

            if (document) {
                // Update existing document
                if (document.fileUrl) {
                    await deleteFromCloudStorage(document.fileUrl);
                }

                document.name = file.originalname;
                document.originalName = file.originalname;
                document.fileUrl = fileUrl;
                document.fileSize = file.size;
                document.mimeType = file.mimetype;
                document.status = 'pending';
                document.reviewNotes = '';
                document.reviewedBy = null;
                document.reviewedAt = null;
                document.expiryDate = expiryDate ? new Date(expiryDate) : null;
                document.updatedAt = new Date();
            } else {
                // Create new document record
                document = new Document({
                    applicationId,
                    clientId: req.user._id,
                    type: documentType,
                    name: file.originalname,
                    originalName: file.originalname,
                    fileUrl,
                    fileSize: file.size,
                    mimeType: file.mimetype,
                    status: 'pending',
                    expiryDate: expiryDate ? new Date(expiryDate) : null
                });
            }

            await document.save();

            // Clean up temp file
            await fs.unlink(file.path).catch(() => {});

            // Notify admin/adviser about new document upload
            if (application.adviserId) {
                await sendNotification({
                    userId: application.adviserId,
                    applicationId,
                    type: 'document_uploaded',
                    title: 'New Document Uploaded',
                    message: `${req.user.profile.firstName} uploaded a new ${documentType.replace('_', ' ')} document`,
                    priority: 'medium'
                });
            }

            res.status(200).json({
                success: true,
                message: 'Document uploaded successfully',
                data: document
            });
        } catch (error) {
            // Clean up temp file if it exists
            if (req.file) {
                await fs.unlink(req.file.path).catch(() => {});
            }

            res.status(500).json({
                success: false,
                message: 'Error uploading document',
                error: error.message
            });
        }
    }
);

// Review document (admin/adviser only)
router.patch('/:id/review',
    auth,
    authorize('admin', 'adviser'),
    auditLogger('review', 'document'),
    async (req, res) => {
        try {
            const { status, reviewNotes } = req.body;
            const documentId = req.params.id;

            const document = await Document.findById(documentId)
                .populate('applicationId');

            if (!document) {
                return res.status(404).json({
                    success: false,
                    message: 'Document not found'
                });
            }

            const oldStatus = document.status;
            document.status = status;
            document.reviewNotes = reviewNotes;
            document.reviewedBy = req.user._id;
            document.reviewedAt = new Date();

            await document.save();

            // Send notification to client
            const notificationType = status === 'approved' ? 'document_approved' : 'document_rejected';
            const notificationTitle = status === 'approved' ?
                'Document Approved' : 'Document Requires Attention';
            const notificationMessage = status === 'approved' ?
                `Your ${document.type.replace('_', ' ')} document has been approved` :
                `Your ${document.type.replace('_', ' ')} document needs revision: ${reviewNotes}`;

            await sendNotification({
                userId: document.applicationId.clientId,
                applicationId: document.applicationId._id,
                type: notificationType,
                title: notificationTitle,
                message: notificationMessage,
                priority: status === 'rejected' ? 'high' : 'medium',
                actionRequired: status === 'rejected'
            });

            res.status(200).json({
                success: true,
                message: 'Document reviewed successfully',
                data: document
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                message: 'Error reviewing document',
                error: error.message
            });
        }
    }
);

// Delete document
router.delete('/:id',
    auth,
    auditLogger('delete', 'document'),
    async (req, res) => {
        try {
            const documentId = req.params.id;

            const document = await Document.findById(documentId)
                .populate('applicationId');

            if (!document) {
                return res.status(404).json({
                    success: false,
                    message: 'Document not found'
                });
            }

            // Check permissions
            const canDelete = req.user.role === 'admin' ||
                req.user.role === 'adviser' ||
                (req.user.role === 'client' &&
                    document.applicationId.clientId.toString() === req.user._id.toString() &&
                    document.status === 'pending');

            if (!canDelete) {
                return res.status(403).json({
                    success: false,
                    message: 'Access denied. Cannot delete approved documents.'
                });
            }

            // Delete from cloud storage
            if (document.fileUrl) {
                await deleteFromCloudStorage(document.fileUrl);
            }

            await Document.findByIdAndDelete(documentId);

            res.status(200).json({
                success: true,
                message: 'Document deleted successfully'
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                message: 'Error deleting document',
                error: error.message
            });
        }
    }
);

// Download document
router.get('/:id/download', auth, async (req, res) => {
    try {
        const documentId = req.params.id;

        const document = await Document.findById(documentId)
            .populate('applicationId');

        if (!document) {
            return res.status(404).json({
                success: false,
                message: 'Document not found'
            });
        }

        // Check permissions
        const hasAccess = req.user.role === 'admin' ||
            req.user.role === 'adviser' ||
            (req.user.role === 'client' &&
                document.applicationId.clientId.toString() === req.user._id.toString());

        if (!hasAccess) {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }

        // Generate secure download URL (implementation depends on your cloud storage)
        const downloadUrl = await generateSecureDownloadUrl(document.fileUrl);

        res.status(200).json({
            success: true,
            data: {
                downloadUrl,
                filename: document.originalName,
                expiresIn: 3600 // URL expires in 1 hour
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error generating download URL',
            error: error.message
        });
    }
});

// Get document checklist for visa type
router.get('/checklist/:visaType', auth, async (req, res) => {
    try {
        const { visaType } = req.params;
        const checklist = getDocumentChecklist(visaType);

        res.status(200).json({
            success: true,
            data: checklist
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error fetching document checklist',
            error: error.message
        });
    }
});

// Helper function to get document checklist
function getDocumentChecklist(visaType) {
    const commonDocs = [
        {
            type: 'passport',
            name: 'Passport Copy',
            description: 'Clear copy of passport information page',
            required: true,
            formats: ['PDF', 'JPG', 'PNG']
        },
        {
            type: 'photo',
            name: 'Passport Photos',
            description: 'Recent passport-sized photographs',
            required: true,
            formats: ['JPG', 'PNG']
        },
        {
            type: 'police_clearance',
            name: 'Police Clearance Certificate',
            description: 'Police clearance from all countries lived in for 12+ months',
            required: true,
            formats: ['PDF']
        }
    ];

    const visaSpecificDocs = {
        work: [
            {
                type: 'job_offer',
                name: 'Job Offer Letter',
                description: 'Official job offer from NZ employer',
                required: true,
                formats: ['PDF', 'DOC', 'DOCX']
            },
            {
                type: 'employment_contract',
                name: 'Employment Contract',
                description: 'Signed employment agreement',
                required: true,
                formats: ['PDF', 'DOC', 'DOCX']
            },
            {
                type: 'qualification_documents',
                name: 'Qualification Documents',
                description: 'Educational certificates and transcripts',
                required: true,
                formats: ['PDF']
            }
        ],
        partner: [
            {
                type: 'marriage_certificate',
                name: 'Marriage/Partnership Certificate',
                description: 'Official marriage or civil union certificate',
                required: true,
                formats: ['PDF']
            },
            {
                type: 'financial_records',
                name: 'Financial Evidence',
                description: 'Bank statements, employment letters, tax returns',
                required: true,
                formats: ['PDF']
            }
        ],
        student: [
            {
                type: 'qualification_documents',
                name: 'Academic Qualifications',
                description: 'Certificates, diplomas, transcripts',
                required: true,
                formats: ['PDF']
            },
            {
                type: 'financial_records',
                name: 'Financial Evidence',
                description: 'Proof of funds for study and living costs',
                required: true,
                formats: ['PDF']
            }
        ]
    };

    return {
        visaType,
        documents: [...commonDocs, ...(visaSpecificDocs[visaType] || [])]
    };
}

module.exports = router;
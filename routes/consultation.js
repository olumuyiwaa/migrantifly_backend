
const express = require('express');
const { Consultation, User } = require('../models');
const { auth, authorize } = require('../middleware/auth');
const { auditLogger } = require('../middleware/auditLog');
const { sendEmail } = require('../utils/email');
const { generateClientToken } = require('../utils/tokenGenerator');

const router = express.Router();

// Book consultation (public endpoint)
router.post('/book', async (req, res) => {
    try {
        const {
            clientEmail,
            clientName,
            clientPhone,
            preferredDate,
            preferredTime,
            method,
            message
        } = req.body;

        // Create consultation record
        const consultation = new Consultation({
            scheduledDate: new Date(`${preferredDate} ${preferredTime}`),
            method,
            status: 'scheduled',
            notes: message
        });

        // Find or create client user record
        let client = await User.findOne({ email: clientEmail });
        if (!client) {
            client = new User({
                email: clientEmail,
                password: 'temp', // Will be set during account setup
                profile: {
                    firstName: clientName.split(' ')[0],
                    lastName: clientName.split(' ').slice(1).join(' '),
                    phone: clientPhone
                },
                isEmailVerified: false
            });
            await client.save();
        }

        consultation.clientId = client._id;
        await consultation.save();

        // Send confirmation email
        await sendEmail({
            to: clientEmail,
            subject: 'Consultation Booked - Migrantifly',
            template: 'consultation-confirmation',
            data: {
                clientName,
                consultationDate: new Date(`${preferredDate} ${preferredTime}`).toLocaleString(),
                method,
                consultationId: consultation._id
            }
        });

        res.status(201).json({
            success: true,
            message: 'Consultation booked successfully',
            data: {
                consultationId: consultation._id,
                scheduledDate: consultation.scheduledDate
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error booking consultation',
            error: error.message
        });
    }
});

// Get consultations (admin/adviser view)
router.get('/',
    auth,
    authorize('admin', 'adviser'),
    async (req, res) => {
        try {
            const { status, date, page = 1, limit = 20 } = req.query;

            const filter = {};
            if (status) filter.status = status;
            if (date) {
                const targetDate = new Date(date);
                const nextDay = new Date(targetDate);
                nextDay.setDate(nextDay.getDate() + 1);
                filter.scheduledDate = {
                    $gte: targetDate,
                    $lt: nextDay
                };
            }

            const consultations = await Consultation.find(filter)
                .populate('clientId', 'email profile')
                .populate('adviserId', 'email profile')
                .sort({ scheduledDate: 1 })
                .limit(limit * 1)
                .skip((page - 1) * limit);

            const total = await Consultation.countDocuments(filter);

            res.status(200).json({
                success: true,
                data: {
                    consultations,
                    totalPages: Math.ceil(total / limit),
                    currentPage: page,
                    total
                }
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                message: 'Error fetching consultations',
                error: error.message
            });
        }
    }
);

// Complete consultation
router.patch('/:id/complete',
    auth,
    authorize('admin', 'adviser'),
    auditLogger('complete_consultation', 'consultation'),
    async (req, res) => {
        try {
            const { notes, visaPathways, proceedWithApplication } = req.body;
            const consultationId = req.params.id;

            const consultation = await Consultation.findById(consultationId)
                .populate('clientId');

            if (!consultation) {
                return res.status(404).json({
                    success: false,
                    message: 'Consultation not found'
                });
            }

            consultation.status = 'completed';
            consultation.notes = notes;
            consultation.visaPathways = visaPathways;
            consultation.adviserId = req.user._id;

            if (proceedWithApplication) {
                // Generate client token for account setup
                const clientToken = generateClientToken();
                consultation.clientToken = clientToken;

                // Update client user with token
                await User.findByIdAndUpdate(consultation.clientId._id, {
                    token: clientToken
                });

                // Send account setup email
                await sendEmail({
                    to: consultation.clientId.email,
                    subject: 'Complete Your Migrantifly Account Setup',
                    template: 'account-setup',
                    data: {
                        clientName: `${consultation.clientId.profile.firstName} ${consultation.clientId.profile.lastName}`,
                        setupLink: `${process.env.FRONTEND_URL}/setup-account?token=${clientToken}`,
                        consultationId: consultation._id,
                        visaPathways
                    }
                });
            }

            await consultation.save();

            res.status(200).json({
                success: true,
                message: 'Consultation completed successfully',
                data: consultation
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                message: 'Error completing consultation',
                error: error.message
            });
        }
    }
);

module.exports = router;

/**
 * @openapi
 * tags:
 *   - name: Consultations
 *     description: Consultation booking and management
 *
 * /api/consultation/book:
 *   post:
 *     tags: [Consultations]
 *     summary: Book a consultation (public)
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               clientEmail: { type: string, format: email }
 *               clientName: { type: string }
 *               clientPhone: { type: string }
 *               preferredDate: { type: string, example: "2025-01-31" }
 *               preferredTime: { type: string, example: "10:00" }
 *               method: { type: string, enum: ["online","phone","in_person"] }
 *               message: { type: string }
 *             required: [clientEmail, clientName, preferredDate, preferredTime, method]
 *     responses:
 *       201: { description: Consultation booked }
 *       500: { description: Error booking consultation }
 *
 * /api/consultation:
 *   get:
 *     tags: [Consultations]
 *     summary: List consultations (admin/adviser)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string }
 *       - in: query
 *         name: date
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
 *     responses:
 *       200: { description: Consultations returned }
 *       401: { description: Unauthorized }
 *       403: { description: Forbidden }
 *
 * /api/consultation/{id}/complete:
 *   patch:
 *     tags: [Consultations]
 *     summary: Complete a consultation and optionally create setup token
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
 *               notes: { type: string }
 *               visaPathways:
 *                 type: array
 *                 items: { type: string }
 *               proceedWithApplication: { type: boolean }
 *     responses:
 *       200: { description: Consultation completed }
 *       401: { description: Unauthorized }
 *       403: { description: Forbidden }
 *       404: { description: Not found }
 */
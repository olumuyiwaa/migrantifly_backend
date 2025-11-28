const express = require('express');
const crypto = require('crypto');
const { Consultation, User, Payment } = require('../models');
const { auth, authorize } = require('../middleware/auth');
const { auditLogger } = require('../middleware/auditLog');
const { sendEmail } = require('../utils/email');
const { generateClientToken } = require('../utils/tokenGenerator');

const router = express.Router();

// Configuration
const CONSULTATION_FEE = 50; // USD
const SLOT_DURATION = 60; // minutes
// Hold window for unpaid consultations before auto-delete (TTL)
const HOLD_MINUTES = parseInt(process.env.CONSULTATION_HOLD_MINUTES || '30', 10);

/**
 * Check if a slot is available
 * @param {Date} startTime - Slot start time
 * @param {Date} endTime - Slot end time
 * @returns {Promise<boolean>}
 */
async function isSlotAvailable(startTime, endTime) {
    const existingConsultation = await Consultation.findOne({
        scheduledDate: {
            $gte: startTime,
            $lt: endTime
        },
        status: { $in: ['scheduled', 'completed'] }
    });
    return !existingConsultation;
}

/**
 * Get available slots for a specific date
 * @param {string} date - Format: YYYY-MM-DD
 * @returns {Promise<Array>} - Array of available hours (0-23)
 */
async function getAvailableSlotsForDate(date) {
    const dayStart = new Date(`${date}T00:00:00Z`);
    const dayEnd = new Date(`${date}T23:59:59Z`);

    const consultations = await Consultation.find({
        scheduledDate: {
            $gte: dayStart,
            $lte: dayEnd
        },
        status: { $in: ['scheduled', 'completed'] }
    });

    const bookedHours = new Set(
      consultations.map(c => new Date(c.scheduledDate).getUTCHours())
    );

    // Available hours: 8 AM to 6 PM (business hours)
    const availableSlots = [];
    for (let hour = 8; hour < 18; hour++) {
        if (!bookedHours.has(hour)) {
            availableSlots.push(hour);
        }
    }

    return availableSlots;
}

// Get available consultation slots
router.get('/available-slots', async (req, res) => {
    try {
        const { date } = req.query;

        if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid date format. Use YYYY-MM-DD'
            });
        }

        // Prevent booking in the past
        const requestedDate = new Date(date);
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        if (requestedDate < today) {
            return res.status(400).json({
                success: false,
                message: 'Cannot book consultations in the past'
            });
        }

        const availableSlots = await getAvailableSlotsForDate(date);

        res.status(200).json({
            success: true,
            data: {
                date,
                availableSlots,
                consultationFee: CONSULTATION_FEE,
                timezone: 'UTC'
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error fetching available slots',
            error: error.message
        });
    }
});

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

        // Validate required fields
        if (!clientEmail || !clientName || !preferredDate || !preferredTime || !method) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields'
            });
        }

        // Validate date format
        if (!/^\d{4}-\d{2}-\d{2}$/.test(preferredDate)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid date format. Use YYYY-MM-DD'
            });
        }

        // Validate time format
        if (!/^\d{2}:\d{2}$/.test(preferredTime)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid time format. Use HH:MM'
            });
        }

        // Normalize method from public API to schema values
        const methodMap = {
            'online': 'zoom',
            'in_person': 'in-person'
        };
        const normalizedMethod = methodMap[method] || method;

        if (!['zoom', 'phone', 'in-person', 'google-meet'].includes(normalizedMethod)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid consultation method'
            });
        }

        // Create scheduled date object
        const scheduledDateTime = new Date(`${preferredDate}T${preferredTime}:00Z`);
        const slotEndTime = new Date(scheduledDateTime.getTime() + SLOT_DURATION * 60000);

        // Prevent booking in the past
        if (scheduledDateTime < new Date()) {
            return res.status(400).json({
                success: false,
                message: 'Cannot book consultations in the past'
            });
        }

        // Check slot availability
        const slotAvailable = await isSlotAvailable(scheduledDateTime, slotEndTime);
        if (!slotAvailable) {
            return res.status(409).json({
                success: false,
                message: 'This time slot is already booked. Please select another time.',
                code: 'SLOT_UNAVAILABLE'
            });
        }

        // Find or create client user record
        let client = await User.findOne({ email: clientEmail });
        if (!client) {
            const [firstName, ...rest] = (clientName || '').trim().split(/\s+/);
            client = new User({
                email: clientEmail,
                password: "password123", // temporary; to be changed during setup
                profile: {
                    firstName: firstName || 'Client',
                    lastName: rest.join(' '),
                    phone: clientPhone
                },
                isEmailVerified: false
            });
            await client.save();
        }

        // Create consultation record (status: pending_payment)
        const consultation = new Consultation({
            clientId: client._id,
            scheduledDate: scheduledDateTime,
            duration: SLOT_DURATION,
            method: normalizedMethod,
            status: 'pending_payment',
            notes: message,
            // Set TTL expiration for unpaid booking
            expiresAt: new Date(Date.now() + HOLD_MINUTES * 60 * 1000)
        });
        await consultation.save();

        // Create payment record for consultation fee
        const payment = new Payment({
            clientId: client._id,
            type: 'consultation_fee',
            amount: CONSULTATION_FEE,
            currency: 'USD',
            status: 'pending',
            notes: `Consultation fee for ${preferredDate} at ${preferredTime}`
        });
        await payment.save();

        // Link consultation to payment
        consultation.paymentId = payment._id;
        await consultation.save();

        res.status(201).json({
            success: true,
            message: 'Consultation slot reserved. Please complete payment to confirm.',
            data: {
                consultationId: consultation._id,
                paymentId: payment._id,
                scheduledDate: consultation.scheduledDate,
                consultationFee: CONSULTATION_FEE,
                status: 'pending_payment',
                nextStep: 'Complete payment to confirm your booking'
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

// Confirm consultation after payment (public - no auth required)
router.patch('/:id/confirm-booking', async (req, res) => {
    try {
        const consultationId = req.params.id;
        const { email } = req.body; // Verify ownership via email

        const consultation = await Consultation.findById(consultationId)
          .populate('clientId');

        if (!consultation) {
            return res.status(404).json({
                success: false,
                message: 'Consultation not found'
            });
        }

        // Verify email matches
        if (consultation.clientId.email !== email) {
            return res.status(403).json({
                success: false,
                message: 'Email does not match consultation record'
            });
        }

        if (consultation.status === 'pending_payment') {
            return res.status(400).json({
                success: false,
                message: 'Payment not completed yet'
            });
        }

        if (consultation.status === 'cancelled') {
            return res.status(400).json({
                success: false,
                message: 'Consultation is cancelled'
            });
        }

        // Update status
        consultation.status = 'scheduled';
        await consultation.save();

        // Send confirmation email
        try {
            await sendEmail({
                to: consultation.clientId.email,
                subject: 'Consultation Confirmed - Migrantifly',
                template: 'consultation-confirmation',
                data: {
                    clientName: consultation.clientId.profile.firstName,
                    consultationDate: consultation.scheduledDate.toLocaleString(),
                    method: consultation.method,
                    consultationId: consultation._id,
                    status: 'confirmed'
                }
            });
        } catch (emailErr) {
            console.error('Email send failed:', emailErr?.message);
        }

        res.status(200).json({
            success: true,
            message: 'Consultation confirmed successfully',
            data: {
                consultationId: consultation._id,
                status: 'scheduled',
                scheduledDate: consultation.scheduledDate
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error confirming consultation',
            error: error.message
        });
    }
});

// Cancel consultation (within 24 hours before = no refund)
router.patch('/:id/cancel',
  auth,
  async (req, res) => {
      try {
          const consultationId = req.params.id;
          const consultation = await Consultation.findById(consultationId)
            .populate('clientId');

          if (!consultation) {
              return res.status(404).json({
                  success: false,
                  message: 'Consultation not found'
              });
          }

          if (consultation.clientId._id.toString() !== req.user._id.toString() &&
            req.user.role !== 'admin' && req.user.role !== 'adviser') {
              return res.status(403).json({
                  success: false,
                  message: 'Unauthorized'
              });
          }

          if (!['scheduled', 'pending_payment'].includes(consultation.status)) {
              return res.status(400).json({
                  success: false,
                  message: 'Cannot cancel this consultation'
              });
          }

          // Check if within 24 hours
          const hoursUntilConsultation = (consultation.scheduledDate - new Date()) / (1000 * 60 * 60);
          const canRefund = hoursUntilConsultation > 24;

          // Update consultation status
          consultation.status = 'cancelled';
          await consultation.save();

          // Handle refund if applicable
          if (consultation.paymentId && canRefund) {
              const payment = await Payment.findById(consultation.paymentId);
              if (payment && payment.status === 'completed') {
                  payment.status = 'refunded';
                  await payment.save();
              }
          }

          res.status(200).json({
              success: true,
              message: 'Consultation cancelled',
              data: {
                  consultationId: consultation._id,
                  refundStatus: canRefund ? 'refund_processed' : 'no_refund_within_24_hours',
                  refundReason: canRefund ? null : 'Cancellation within 24 hours of scheduled time'
              }
          });
      } catch (error) {
          res.status(500).json({
              success: false,
              message: 'Error cancelling consultation',
              error: error.message
          });
      }
  }
);

// Get consultations for logged-in client
router.get('/my-consultations',
  auth,
  async (req, res) => {
      try {
          const { status, page = 1, limit = 20 } = req.query;

          const filter = { clientId: req.user._id };
          if (status) filter.status = status;

          const consultations = await Consultation.find(filter)
            .populate('adviserId', 'email profile')
            .populate('paymentId')
            .sort({ scheduledDate: -1 })
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
              const clientToken = generateClientToken();
              consultation.clientToken = clientToken;

              await User.findByIdAndUpdate(consultation.clientId._id, {
                  token: clientToken
              });

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

// Edit consultation details (admin/adviser only)
router.patch('/:id/edit',
  auth,
  authorize('admin', 'adviser'),
  async (req, res) => {
      try {
          const consultationId = req.params.id;

          const {
              preferredDate,   // YYYY-MM-DD
              preferredTime,   // HH:MM
              duration,
              method,
              type,
              notes,
              meetingLink,
              rescheduleReason
          } = req.body;

          let consultation = await Consultation.findById(consultationId);

          if (!consultation) {
              return res.status(404).json({
                  success: false,
                  message: 'Consultation not found'
              });
          }

          // Cannot edit completed/cancelled consultations
          if (['completed', 'cancelled'].includes(consultation.status)) {
              return res.status(400).json({
                  success: false,
                  message: 'This consultation cannot be edited'
              });
          }

          // ================================
          // VALIDATE DATE + TIME (IF PROVIDED)
          // ================================

          let newScheduledDate = null;
          if (preferredDate && preferredTime) {

              // Validate formats
              if (!/^\d{4}-\d{2}-\d{2}$/.test(preferredDate)) {
                  return res.status(400).json({
                      success: false,
                      message: 'Invalid date format. Use YYYY-MM-DD'
                  });
              }

              if (!/^\d{2}:\d{2}$/.test(preferredTime)) {
                  return res.status(400).json({
                      success: false,
                      message: 'Invalid time format. Use HH:MM'
                  });
              }

              newScheduledDate = new Date(`${preferredDate}T${preferredTime}:00Z`);

              if (newScheduledDate < new Date()) {
                  return res.status(400).json({
                      success: false,
                      message: 'Cannot schedule consultation in the past'
                  });
              }

              const endTime = new Date(newScheduledDate.getTime() + (duration || consultation.duration) * 60000);

              // Check slot availability
              const slotAvailable = await isSlotAvailable(newScheduledDate, endTime);
              if (!slotAvailable) {
                  return res.status(409).json({
                      success: false,
                      message: 'This new slot is already booked',
                      code: 'SLOT_UNAVAILABLE'
                  });
              }
          }

          // ================================
          // UPDATE FIELDS
          // ================================
          let wasRescheduled = false;

          if (newScheduledDate) {
              consultation.rescheduledFrom = consultation._id;
              consultation.rescheduleReason = rescheduleReason || 'Schedule updated';
              consultation.scheduledDate = newScheduledDate;
              wasRescheduled = true;
          }

          if (duration) consultation.duration = duration;
          if (method) consultation.method = method;
          if (type) consultation.type = type;
          if (notes !== undefined) consultation.notes = notes;
          if (meetingLink) consultation.meetingLink = meetingLink;

          if (wasRescheduled) {
              consultation.status = 'rescheduled';
          }

          await consultation.save();

          res.status(200).json({
              success: true,
              message: 'Consultation updated successfully',
              data: consultation
          });

      } catch (error) {
          res.status(500).json({
              success: false,
              message: 'Error updating consultation',
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
 * /api/consultation/my-consultations:
 *   get:
 *     tags: [Consultations]
 *     summary: List consultations (signed in user)
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
 *       404: { description: Not found }
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
 * /api/consultation/{id}/edit:
 *   patch:
 *     tags: [Consultations]
 *     summary: Edit an existing consultation (admin/adviser)
 *     description: >
 *       Allows an admin or adviser to modify consultation details such as
 *       scheduled date, time, method, meeting link, or notes.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the consultation.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               scheduledDate:
 *                 type: string
 *                 format: date-time
 *                 example: "2025-02-10T14:00:00Z"
 *               method:
 *                 type: string
 *                 enum: ["zoom", "phone", "in-person", "google-meet"]
 *               duration:
 *                 type: integer
 *                 example: 60
 *               meetingLink:
 *                 type: string
 *                 example: "https://zoom.us/xyz"
 *               notes:
 *                 type: string
 *                 example: "Updated consultation details."
 *               rescheduleReason:
 *                 type: string
 *                 example: "Client requested new time"
 *     responses:
 *       200:
 *         description: Consultation updated successfully
 *       400:
 *         description: Invalid data or unavailable time slot
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Consultation not found
 */

//
// PATCH /:id/cancel endpoint handles cancellations
//
// New Endpoints:
//
//   GET /available-slots - Check available time slots for a date
// POST /book - Reserve a slot (creates pending payment)
// PATCH /:id/confirm-booking - Confirm after payment
// PATCH /:id/cancel - Cancel with refund logic
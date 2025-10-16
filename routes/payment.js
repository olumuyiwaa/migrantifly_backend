const express = require('express');
const mongoose = require('mongoose');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { body, validationResult } = require('express-validator');
const { Payment, Application, Agreement } = require('../models');
const { auth, authorize } = require('../middleware/auth');
const { auditLogger } = require('../middleware/auditLog');
const { generateInvoice } = require('../utils/invoiceGenerator');
const { sendNotification } = require('../utils/notifications');
const { sendEmail } = require('../utils/email');

const router = express.Router();

// Validation middleware
const paymentValidation = [
    body('amount')
        .isFloat({ min: 0.01, max: 1000000 })
        .withMessage('Invalid payment amount'),
    body('applicationId')
        .isMongoId()
        .withMessage('Invalid application ID')
];

// Create payment intent for deposit with validation
router.post('/create-deposit-payment',
    auth,
    paymentValidation,
    async (req, res) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({
                    success: false,
                    errors: errors.array()
                });
            }

            const { applicationId, amount } = req.body;

            // Transaction handling
            const session = await mongoose.startSession();
            session.startTransaction();

            try {
                const application = await Application.findOne({
                    _id: applicationId,
                    clientId: req.user._id
                }).session(session);

                if (!application) {
                    await session.abortTransaction();
                    return res.status(404).json({
                        success: false,
                        message: 'Application not found'
                    });
                }

                // Validate payment amount against application requirements
                if (amount !== application.depositAmount) {
                    await session.abortTransaction();
                    return res.status(400).json({
                        success: false,
                        message: 'Invalid deposit amount'
                    });
                }

                const payment = new Payment({
                    clientId: req.user._id,
                    applicationId,
                    amount,
                    currency: 'USD',
                    type: 'deposit',
                    status: 'pending'
                });

                await payment.save({ session });

                const paymentIntent = await stripe.paymentIntents.create({
                    amount: Math.round(amount * 100),
                    currency: 'usd',
                    metadata: {
                        paymentId: payment._id.toString(),
                        applicationId: applicationId.toString(),
                        clientId: req.user._id.toString(),
                        type: 'deposit'
                    }
                });

                payment.transactionId = paymentIntent.id;
                await payment.save({ session });
                await session.commitTransaction();

                res.status(200).json({
                    success: true,
                    data: {
                        clientSecret: paymentIntent.client_secret,
                        paymentId: payment._id
                    }
                });
            } catch (error) {
                await session.abortTransaction();
                throw error;
            }
        } catch (error) {
            console.error("Payment creation failed:", error);
            res.status(500).json({
                success: false,
                message: 'Payment creation failed',
                error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
            });
        }
    });


// Confirm payment
router.post('/confirm-payment',
    auth,
    auditLogger('confirm_payment', 'payment'),
    async (req, res) => {
        try {
            const { paymentId, paymentIntentId } = req.body;

            const payment = await Payment.findOne({
                _id: paymentId,
                clientId: req.user._id
            });

            if (!payment) {
                return res.status(404).json({
                    success: false,
                    message: 'Payment not found'
                });
            }

            // Verify payment with Stripe
            const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

            if (paymentIntent.status === 'succeeded') {
                payment.status = 'completed';
                payment.gatewayReference = paymentIntent.id;
                await payment.save();

                // Generate invoice
                const invoiceUrl = await generateInvoice({
                    payment,
                    client: req.user,
                    invoiceNumber: `INV-${Date.now()}`
                });

                payment.invoiceUrl = invoiceUrl;
                payment.invoiceNumber = `INV-${Date.now()}`;
                await payment.save();

                // Update application stage if this is deposit payment
                if (payment.type === 'deposit') {
                    const application = await Application.findById(payment.applicationId);
                    if (application && application.stage === 'consultation') {
                        application.stage = 'deposit_paid';
                        application.progress = 20;
                        application.timeline.push({
                            stage: 'deposit_paid',
                            date: new Date(),
                            notes: 'Deposit payment received',
                            updatedBy: req.user._id
                        });
                        await application.save();
                    }
                }

                // Send confirmation email
                await sendEmail({
                    to: req.user.email,
                    subject: 'Payment Confirmation - Migrantifly',
                    template: 'payment-confirmation',
                    data: {
                        clientName: `${req.user.profile.firstName} ${req.user.profile.lastName}`,
                        amount: payment.amount,
                        currency: payment.currency,
                        invoiceUrl,
                        paymentType: payment.type
                    }
                });

                res.status(200).json({
                    success: true,
                    message: 'Payment confirmed successfully',
                    data: {
                        payment,
                        invoiceUrl
                    }
                });
            } else {
                payment.status = 'failed';
                await payment.save();

                res.status(400).json({
                    success: false,
                    message: 'Payment failed'
                });
            }
        } catch (error) {
            res.status(500).json({
                success: false,
                message: 'Error confirming payment',
                error: error.message
            });
        }
    }
);

// Get payment history
router.get('/history', auth, async (req, res) => {
    try {
        const filter = req.user.role === 'client'
            ? { clientId: req.user._id }
            : {};

        const payments = await Payment.find(filter)
            .populate('clientId', 'email profile')
            .populate('applicationId', 'visaType inzReference')
            .sort({ createdAt: -1 });

        res.status(200).json({
            success: true,
            data: payments
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error fetching payment history',
            error: error.message
        });
    }
});

// Stripe webhook handler
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        console.error('Webhook signature verification failed:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle the event
    switch (event.type) {
        case 'payment_intent.succeeded':
            const paymentIntent = event.data.object;
            await handlePaymentSuccess(paymentIntent);
            break;

        case 'payment_intent.payment_failed':
            const failedPayment = event.data.object;
            await handlePaymentFailure(failedPayment);
            break;

        default:
            console.log(`Unhandled event type ${event.type}`);
    }

    res.json({ received: true });
});

// Helper function to handle successful payments
async function handlePaymentSuccess(paymentIntent) {
    try {
        const payment = await Payment.findOne({
            transactionId: paymentIntent.id
        });

        if (payment && payment.status !== 'completed') {
            payment.status = 'completed';
            payment.gatewayReference = paymentIntent.id;
            await payment.save();

            // Send notification
            await sendNotification({
                userId: payment.clientId,
                applicationId: payment.applicationId,
                type: 'payment_received',
                title: 'Payment Received',
                message: `Your ${payment.type} payment of ${payment.currency} ${payment.amount} has been processed successfully`,
                priority: 'medium'
            });
        }
    } catch (error) {
        console.error('Error handling payment success:', error);
    }
}

// Helper function to handle failed payments
async function handlePaymentFailure(paymentIntent) {
    try {
        const payment = await Payment.findOne({
            transactionId: paymentIntent.id
        });

        if (payment) {
            payment.status = 'failed';
            await payment.save();

            // Send notification
            await sendNotification({
                userId: payment.clientId,
                applicationId: payment.applicationId,
                type: 'payment_failed',
                title: 'Payment Failed',
                message: `Your ${payment.type} payment could not be processed. Please try again.`,
                priority: 'high',
                actionRequired: true
            });
        }
    } catch (error) {
        console.error('Error handling payment failure:', error);
    }
}

module.exports = router;


/**
 * @openapi
 * tags:
 *   - name: Payments
 *     description: Payment processing
 *
 * /api/payments/create-deposit-payment:
 *   post:
 *     tags: [Payments]
 *     summary: Create a Stripe PaymentIntent for deposit
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               applicationId: { type: string }
 *               amount: { type: number, minimum: 0.01 }
 *             required: [applicationId, amount]
 *     responses:
 *       200: { description: Client secret returned }
 *       400: { description: Validation error }
 *       404: { description: Application not found }
 *
 * /api/payments/confirm-payment:
 *   post:
 *     tags: [Payments]
 *     summary: Confirm a completed payment
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               paymentId: { type: string }
 *               paymentIntentId: { type: string }
 *             required: [paymentId, paymentIntentId]
 *     responses:
 *       200: { description: Payment confirmed and invoice generated }
 *       400: { description: Payment failed }
 *       404: { description: Payment not found }
 *
 * /api/payments/history:
 *   get:
 *     tags: [Payments]
 *     summary: Get payment history
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Payment list returned }
 *
 * /api/payments/webhook:
 *   post:
 *     tags: [Payments]
 *     summary: Stripe webhook endpoint
 *     description: This endpoint is called by Stripe. Do not add authentication.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200: { description: Webhook received }
 *       400: { description: Invalid signature }
 */
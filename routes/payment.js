const express = require('express');
const mongoose = require('mongoose');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { body, validationResult } = require('express-validator');
const { Payment, Consultation, Application, Agreement } = require('../models');
const { auth, authorize } = require('../middleware/auth');
const { auditLogger } = require('../middleware/auditLog');
const { generateInvoice } = require('../utils/invoiceGenerator');
const { sendNotification } = require('../utils/notifications');
const { sendEmail } = require('../utils/email');

const router = express.Router();

// ============================================
// PUBLIC ROUTES (NO AUTH REQUIRED)
// ============================================

/**
 * Stripe webhook handler
 * MUST be before express.json() middleware
 */
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

        case 'checkout.session.completed':
            const session = event.data.object;
            await handleCheckoutSessionCompleted(session);
            break;

        default:
            console.log(`Unhandled event type ${event.type}`);
    }

    res.json({ received: true });
});

/**
 * Create Stripe Checkout Session for consultation payment
 * PUBLIC ENDPOINT - No auth required
 */
router.post('/create-consultation-payment', async (req, res) => {
    try {
        const { consultationId, paymentId, amount, email } = req.body;

        // Validate input
        if (!consultationId || !paymentId || !amount || !email) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: consultationId, paymentId, amount, email'
            });
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid email format'
            });
        }

        // Validate amount
        if (typeof amount !== 'number' || amount <= 0 || amount > 10000) {
            return res.status(400).json({
                success: false,
                message: 'Invalid payment amount'
            });
        }

        // Verify consultation exists and matches email
        const consultation = await Consultation.findById(consultationId)
          .populate('clientId');

        if (!consultation) {
            return res.status(404).json({
                success: false,
                message: 'Consultation not found'
            });
        }

        // Check email match (case-insensitive)
        if (consultation.clientId.email.toLowerCase() !== email.toLowerCase()) {
            return res.status(403).json({
                success: false,
                message: 'Email does not match consultation record'
            });
        }

        if (consultation.status !== 'pending_payment') {
            return res.status(400).json({
                success: false,
                message: `Consultation is not pending payment. Current status: ${consultation.status}`
            });
        }

        // Verify payment record
        const payment = await Payment.findById(paymentId);
        if (!payment) {
            return res.status(404).json({
                success: false,
                message: 'Payment record not found'
            });
        }

        if (payment.status !== 'pending') {
            return res.status(400).json({
                success: false,
                message: `Payment has already been processed. Current status: ${payment.status}`
            });
        }

        // Ensure DB linkage for easier admin queries
        if (!payment.consultationId) {
            payment.consultationId = consultationId;
            await payment.save();
        }

        // Create Stripe Checkout Session
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            mode: 'payment',
            customer_email: email,
            line_items: [
                {
                    price_data: {
                        currency: 'usd',
                        product_data: {
                            name: 'Migrantifly Consultation',
                            description: `Initial consultation scheduled for ${consultation.scheduledDate.toLocaleDateString()} at ${consultation.scheduledDate.toLocaleTimeString()}`,
                            images: ['https://migrantifly.com/logo.png'],
                        },
                        unit_amount: Math.round(amount * 100), // Amount in cents
                    },
                    quantity: 1,
                },
            ],
            metadata: {
                paymentId: paymentId.toString(),
                consultationId: consultationId.toString(),
                clientEmail: email,
                type: 'consultation_fee',
            },
            success_url: `${process.env.FRONTEND_URL}/consultation-success?session_id={CHECKOUT_SESSION_ID}&consultationId=${consultationId}`,
            cancel_url: `${process.env.FRONTEND_URL}/?canceled=true`,
        });

        // Update payment with session ID
        payment.transactionId = session.id;
        await payment.save();

        console.log(`✅ Checkout session created: ${session.id} for consultation: ${consultationId}`);

        res.status(200).json({
            success: true,
            data: {
                sessionId: session.id,
                url: session.url, // Include the checkout URL
            }
        });
    } catch (error) {
        console.error('❌ Payment creation failed:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to initialize payment',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
});


//
router.post('/verify-checkout-session', async (req, res) => {
    try {
        const { sessionId } = req.body;
        if (!sessionId || typeof sessionId !== 'string') {
            return res.status(400).json({
                success: false,
                message: 'Missing or invalid sessionId'
            });
        }

        const session = await stripe.checkout.sessions.retrieve(sessionId, {
            expand: ['payment_intent', 'customer_details'],
        });

        const paid = session.payment_status === 'paid';
        const email =
          session.customer_details?.email ||
          session.customer_email ||
          session.customer?.email ||
          null;
        const meta = session.metadata || {};
        const type = meta.type;
        const paymentId = meta.paymentId || null;
        let payment = null;



        if (paid) {
            const metaConsultationId = session.metadata?.consultationId || null;

            try {
                if (paymentId) {
                    payment = await Payment.findById(paymentId);
                    if (payment && payment.status !== 'completed') {
                        payment.status = 'completed';
                        payment.transactionId = session.id;
                        payment.gatewayReference = session.payment_intent?.toString() || payment.gatewayReference;
                        if (!payment.consultationId && metaConsultationId) {
                            payment.consultationId = metaConsultationId;
                        }
                        await payment.save();
                    }
                }

                // If deposit, update application + invoice (in case webhook hasn’t run yet)
                if (type === 'deposit' && meta.applicationId) {
                    const application = await Application.findById(meta.applicationId);
                    if (application && application.stage === 'consultation') {
                        application.stage = 'deposit_paid';
                        application.progress = 20;
                        application.timeline.push({
                            stage: 'deposit_paid',
                            date: new Date(),
                            notes: 'Deposit payment received (Verify)',
                            // Prefer payment.clientId, then metadata clientId, then app client
                            updatedBy: (payment && payment.clientId) || meta.clientId || application.clientId
                        });
                        await application.save();
                    }

                    if (payment && !payment.invoiceUrl) {
                        const invoiceNumber = `INV-${Date.now()}`;
                        try {
                            const invoiceUrl = await generateInvoice({
                                payment,
                                client: {
                                    _id: payment.clientId,
                                    email: session.customer_details?.email || session.customer_email
                                },
                                invoiceNumber
                            });
                            payment.invoiceUrl = invoiceUrl;
                            payment.invoiceNumber = invoiceNumber;
                            await payment.save();
                        } catch (invErr) {
                            console.error('Invoice generation failed after verify:', invErr?.message);
                        }
                    }
                }

                // Idempotently schedule the consultation and unset TTL expiry
                if (metaConsultationId) {
                    await Consultation.findOneAndUpdate(
                      { _id: metaConsultationId, status: { $ne: 'scheduled' } },
                      { $set: { status: 'scheduled' }, $unset: { expiresAt: "" } },
                      { new: true }
                    );
                }
            } catch (finalizeErr) {
                console.error('Finalize after verify failed:', finalizeErr?.message);
            }
        }

        res.status(200).json({
            success: true,
            data: {
                paid,
                email,
                amount: session.amount_total ?? null,
                currency: session.currency ?? 'usd',
                // applicationId: session.metadata?.applicationId || null,
                consultationId: session.metadata?.consultationId || session.metadata?.applicationId || null,
                paymentId: session.metadata?.paymentId || null,
                status: session.status,
                invoiceUrl: paid ? (await (async () => {
                    const p = paymentId ? await Payment.findById(paymentId) : null;
                    return p?.invoiceUrl || null;
                })()) : null

            }
        });
    } catch (err) {
        console.error('Verify checkout session failed:', err?.message);
        res.status(500).json({
            success: false,
            message: 'Failed to verify checkout session',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
});

// ============================================
// PROTECTED ROUTES (AUTH REQUIRED)
// ============================================

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
// router.post('/create-deposit-payment',
//   auth,
//   paymentValidation,
//   async (req, res) => {
//       try {
//           const errors = validationResult(req);
//           if (!errors.isEmpty()) {
//               return res.status(400).json({
//                   success: false,
//                   errors: errors.array()
//               });
//           }
//
//           const { applicationId, amount } = req.body;
//
//           // Transaction handling
//           const session = await mongoose.startSession();
//           session.startTransaction();
//
//           try {
//               const application = await Application.findOne({
//                   _id: applicationId,
//                   clientId: req.user._id
//               }).session(session);
//
//               if (!application) {
//                   await session.abortTransaction();
//                   return res.status(404).json({
//                       success: false,
//                       message: 'Application not found'
//                   });
//               }
//
//               // Validate payment amount against application requirements
//               if (amount !== application.depositAmount) {
//                   await session.abortTransaction();
//                   return res.status(400).json({
//                       success: false,
//                       message: 'Invalid deposit amount'
//                   });
//               }
//
//               const payment = new Payment({
//                   clientId: req.user._id,
//                   applicationId,
//                   amount,
//                   currency: 'USD',
//                   type: 'deposit',
//                   status: 'pending'
//               });
//
//               await payment.save({ session });
//
//               const paymentIntent = await stripe.paymentIntents.create({
//                   amount: Math.round(amount * 100),
//                   currency: 'usd',
//                   metadata: {
//                       paymentId: payment._id.toString(),
//                       applicationId: applicationId.toString(),
//                       clientId: req.user._id.toString(),
//                       type: 'deposit'
//                   }
//               });
//
//               payment.transactionId = paymentIntent.id;
//               await payment.save({ session });
//               await session.commitTransaction();
//
//               res.status(200).json({
//                   success: true,
//                   data: {
//                       clientSecret: paymentIntent.client_secret,
//                       paymentId: payment._id
//                   }
//               });
//           } catch (error) {
//               await session.abortTransaction();
//               throw error;
//           } finally {
//               session.endSession();
//           }
//       } catch (error) {
//           console.error("Payment creation failed:", error);
//           res.status(500).json({
//               success: false,
//               message: 'Payment creation failed',
//               error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
//           });
//       }
//   });


router.post('/create-deposit-checkout',
  auth,
  paymentValidation, // validates applicationId and amount
  async (req, res) => {
      try {
          const { applicationId, amount } = req.body;

          // Validate application belongs to user and the amount matches the deposit
          const application = await Application.findOne({ _id: applicationId, clientId: req.user._id });
          if (!application) {
              return res.status(404).json({ success: false, message: 'Application not found' });
          }
          if (amount !== 500) {
              return res.status(400).json({ success: false, message: 'Invalid deposit amount' });
          }

          // Create payment record
          const payment = new Payment({
              clientId: req.user._id,
              applicationId,
              amount,
              currency: 'USD',
              type: 'deposit',
              status: 'pending',
          });
          await payment.save();

          // Create Checkout Session
          const session = await stripe.checkout.sessions.create({
              mode: 'payment',
              payment_method_types: ['card'],
              customer_email: req.user.email,
              line_items: [
                  {
                      price_data: {
                          currency: 'usd',
                          product_data: {
                              name: 'Application Deposit',
                              description: `Deposit for application ${applicationId}`,
                          },
                          unit_amount: Math.round(amount * 100),
                      },
                      quantity: 1,
                  },
              ],
              metadata: {
                  type: 'deposit',
                  paymentId: payment._id.toString(),
                  applicationId: applicationId.toString(),
                  clientId: req.user._id.toString(),
              },
              success_url: `${process.env.FRONTEND_URL}/consultation-success?session_id={CHECKOUT_SESSION_ID}&applicationId=${applicationId}`,
              cancel_url: `${process.env.FRONTEND_URL}/?canceled=true`,
          });

          // Link transaction to payment
          payment.transactionId = session.id;
          await payment.save();

          return res.status(200).json({
              success: true,
              data: { url: session.url, sessionId: session.id, paymentId: payment._id }
          });
      } catch (error) {
          console.error('Create deposit checkout failed:', error);
          return res.status(500).json({
              success: false,
              message: 'Failed to initialize deposit checkout',
              error: process.env.NODE_ENV === 'development' ? error.message : undefined
          });
      }
  }
);

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

// ============================================
// HELPER FUNCTIONS
// ============================================

// Helper function to handle successful payments
async function handlePaymentSuccess(paymentIntent) {
    try {
        const payment = await Payment.findOne({
            $or: [
                { transactionId: paymentIntent.id },     // PaymentIntent flow
                { gatewayReference: paymentIntent.id }    // Checkout flow: stored here
            ]
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

// Helper function to handle successful checkout
async function handleCheckoutSessionCompleted(session) {
    try {
        const paymentType = session.metadata.type;

        if (paymentType === 'deposit') {
            const paymentId = session.metadata.paymentId;
            const applicationId = session.metadata.applicationId;

            // Update payment status
            const payment = await Payment.findByIdAndUpdate(
              paymentId,
              {
                  status: 'completed',
                  transactionId: session.id,
                  gatewayReference: session.payment_intent,
              },
              { new: true }
            );

            if (!payment) {
                console.error('Deposit payment not found:', paymentId);
                return;
            }

            // Update application stage
            const application = await Application.findById(applicationId);
            if (application && application.stage === 'consultation') {
                application.stage = 'deposit_paid';
                application.progress = 20;
                application.timeline.push({
                    stage: 'deposit_paid',
                    date: new Date(),
                    notes: 'Deposit payment received (Checkout)',
                    updatedBy: payment.clientId
                });
                await application.save();
            }

            // Generate invoice (fetch client for email/name)
            const client = { _id: payment.clientId, email: session.customer_details?.email || session.customer_email };
            const invoiceUrl = await generateInvoice({
                payment,
                client,
                invoiceNumber: `INV-${Date.now()}`
            });

            payment.invoiceUrl = invoiceUrl;
            payment.invoiceNumber = `INV-${Date.now()}`;
            await payment.save();

            // Optional: send confirmation email using your existing email util
            try {
                await sendEmail({
                    to: client.email,
                    subject: 'Payment Confirmation - Migrantifly',
                    template: 'payment-confirmation',
                    data: {
                        clientName: session.customer_details?.name || 'Client',
                        amount: payment.amount,
                        currency: payment.currency,
                        invoiceUrl,
                        paymentType: payment.type
                    }
                });
            } catch (emailErr) {
                console.error('Failed to send deposit confirmation email:', emailErr?.message);
            }

            console.log(`✅ Deposit completed for application ${applicationId}`);
            return;
        }

        const paymentId = session.metadata.paymentId;
        const consultationId = session.metadata.consultationId;
        const email = session.metadata.clientEmail;

        // Update payment status
        const payment = await Payment.findByIdAndUpdate(
          paymentId,
          {
              status: 'completed',
              transactionId: session.id,
              gatewayReference: session.payment_intent,
          },
          { new: true }
        );

        if (!payment) {
            console.error('Payment not found:', paymentId);
            return;
        }

        // Confirm consultation booking
        const consultation = await Consultation.findByIdAndUpdate(
          consultationId,
          { status: 'scheduled' },
          { new: true }
        ).populate('clientId');

        if (!consultation) {
            console.error('Consultation not found:', consultationId);
            return;
        }

        // Send confirmation emails
        try {
            await sendEmail({
                to: email,
                subject: 'Payment Confirmed - Your Consultation is Booked!',
                template: 'consultation-payment-confirmed',
                data: {
                    clientName: consultation.clientId.profile.firstName,
                    consultationDate: consultation.scheduledDate.toLocaleString(),
                    consultationTime: consultation.scheduledDate.toLocaleTimeString(),
                    method: consultation.method,
                    consultationId: consultation._id,
                    amount: payment.amount,
                    meetingLink: consultation.meetingLink || 'Will be sent 24 hours before consultation'
                }
            });
        } catch (emailErr) {
            console.error('Failed to send confirmation email:', emailErr.message);
        }

        console.log(`✅ Payment completed for consultation ${consultationId}`);
    } catch (error) {
        console.error('Error handling checkout session completed:', error);
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
 * components:
 *   schemas:
 *     PaymentType:
 *       type: string
 *       enum: [deposit, consultation_fee]
 *     PaymentStatus:
 *       type: string
 *       enum: [pending, completed, failed]
 *     Payment:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *           example: "PAYMENT_ID_PLACEHOLDER"
 *         clientId:
 *           type: string
 *           example: "CLIENT_ID_PLACEHOLDER"
 *         applicationId:
 *           type: string
 *           nullable: true
 *           example: "APPLICATION_ID_PLACEHOLDER"
 *         amount:
 *           type: number
 *           example: 100
 *         currency:
 *           type: string
 *           example: USD
 *         type:
 *           $ref: '#/components/schemas/PaymentType'
 *         status:
 *           $ref: '#/components/schemas/PaymentStatus'
 *         transactionId:
 *           type: string
 *           example: "pi_1234567890"
 *         gatewayReference:
 *           type: string
 *           example: "pi_1234567890"
 *         invoiceUrl:
 *           type: string
 *           format: uri
 *           nullable: true
 *         invoiceNumber:
 *           type: string
 *           nullable: true
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *     ErrorResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: false
 *         message:
 *           type: string
 *         error:
 *           type: string
 *           nullable: true
 *
 * /api/payments/create-consultation-payment:
 *   post:
 *     tags: [Payments]
 *     summary: Create a Stripe Checkout Session for a consultation payment
 *     description: Public endpoint to initialize a Checkout Session for consultation fees.
 *     security: []  # Overrides global security; this endpoint is public
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               consultationId:
 *                 type: string
 *                 example: "CONSULTATION_ID_PLACEHOLDER"
 *               paymentId:
 *                 type: string
 *                 example: "PAYMENT_ID_PLACEHOLDER"
 *               amount:
 *                 type: number
 *                 minimum: 0.01
 *                 example: 49.99
 *               email:
 *                 type: string
 *                 format: email
 *                 example: "client@example.com"
 *             required: [consultationId, paymentId, amount, email]
 *     responses:
 *       200:
 *         description: Checkout session created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     sessionId:
 *                       type: string
 *                       example: "cs_test_a1B2c3D4"
 *                     clientSecret:
 *                       type: string
 *                       nullable: true
 *                       example: "seti_123_secret_abc"
 *       400:
 *         description: Missing or invalid fields
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: Email does not match consultation record
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Consultation or Payment not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
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
 *               applicationId: { type: string, example: "APPLICATION_ID_PLACEHOLDER" }
 *               amount: { type: number, minimum: 0.01, example: 500 }
 *             required: [applicationId, amount]
 *     responses:
 *       200:
 *         description: Client secret returned
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     clientSecret: { type: string, example: "pi_123_secret_abc" }
 *                     paymentId: { type: string, example: "PAYMENT_ID_PLACEHOLDER" }
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Application not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
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
 *               paymentId: { type: string, example: "PAYMENT_ID_PLACEHOLDER" }
 *               paymentIntentId: { type: string, example: "pi_1234567890" }
 *             required: [paymentId, paymentIntentId]
 *     responses:
 *       200:
 *         description: Payment confirmed and invoice generated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 message: { type: string, example: "Payment confirmed successfully" }
 *                 data:
 *                   type: object
 *                   properties:
 *                     payment:
 *                       $ref: '#/components/schemas/Payment'
 *                     invoiceUrl:
 *                       type: string
 *                       format: uri
 *                       example: "https://example.com/invoices/INV-123.pdf"
 *       400:
 *         description: Payment failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Payment not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *
 * /api/payments/history:
 *   get:
 *     tags: [Payments]
 *     summary: Get payment history
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Payment list returned
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Payment'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *
 * /api/payments/webhook:
 *   post:
 *     tags: [Payments]
 *     summary: Stripe webhook endpoint
 *     description: This endpoint is called by Stripe. Do not add authentication.
 *     security: []
 *     parameters:
 *       - name: Stripe-Signature
 *         in: header
 *         required: true
 *         schema:
 *           type: string
 *         description: Stripe signature header used to verify the webhook payload
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Webhook received
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 received:
 *                   type: boolean
 *                   example: true
 *       400:
 *         description: Invalid signature
 *         content:
 *           text/plain:
 *             schema:
 *               type: string
 *               example: "Webhook Error: Signature verification failed"
 */
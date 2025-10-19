const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
    clientId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    applicationId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Application'
    },
    consultationId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Consultation'
    },
    amount: {
        type: Number,
        required: true
    },
    currency: {
        type: String,
        default: 'USD'
    },
    type: {
        type: String,
        enum: ['deposit', 'final', 'additional', 'refund', 'consultation_fee'],
        required: true
    },
    status: {
        type: String,
        enum: ['pending', 'completed', 'failed', 'refunded', 'partial_refund'],
        default: 'pending'
    },
    paymentMethod: {
        type: String,
        enum: ['credit_card', 'bank_transfer', 'paypal', 'stripe']
    },
    transactionId: String,
    gatewayReference: String,
    invoiceNumber: String,
    invoiceUrl: String,
    notes: String,

    // Refund tracking
    refundAmount: {
        type: Number,
        default: 0
    },
    refundReason: String,
    refundedAt: Date
}, {
    timestamps: true
});

// Index for efficient queries
paymentSchema.index({ clientId: 1, createdAt: -1 });
paymentSchema.index({ applicationId: 1 });
paymentSchema.index({ consultationId: 1 });
paymentSchema.index({ status: 1 });

module.exports.Payment = mongoose.model('Payment', paymentSchema);
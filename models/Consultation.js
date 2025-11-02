const mongoose = require('mongoose');

const consultationSchema = new mongoose.Schema({
    clientId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    adviserId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    paymentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Payment'
    },
    type: {
        type: String,
        enum: ['initial', 'follow-up', 'appeal'],
        default: 'initial'
    },
    scheduledDate: {
        type: Date,
        required: true,
        index: true
    },
    duration: {
        type: Number,
        default: 60 // minutes
    },
    method: {
        type: String,
        enum: ['zoom', 'phone', 'in-person', 'google-meet'],
        required: true
    },
    status: {
        type: String,
        enum: ['pending_payment', 'scheduled', 'completed', 'cancelled', 'rescheduled', 'no-show'],
        default: 'pending_payment'
    },
    notes: String,
    visaPathways: [String],
    clientToken: String,
    meetingLink: String,

    // Rescheduling
    rescheduledFrom: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Consultation'
    },
    rescheduleReason: String,
    // Auto-delete unpaid reservations after a hold window
    expiresAt: {
        type: Date
    }
}, {
    timestamps: true
});

// Index for efficient slot checking
consultationSchema.index({ scheduledDate: 1, status: 1 });

// TTL index: deletes the doc when expiresAt < now
consultationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports.Consultation = mongoose.model('Consultation', consultationSchema);
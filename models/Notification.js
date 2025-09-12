const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    applicationId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Application'
    },
    type: {
        type: String,
        enum: [
            'document_uploaded',
            'document_approved',
            'document_rejected',
            'payment_received',
            'stage_updated',
            'deadline_approaching',
            'rfi_received',
            'ppi_received',
            'decision_received',
            'general'
        ],
        required: true
    },
    title: {
        type: String,
        required: true
    },
    message: {
        type: String,
        required: true
    },
    priority: {
        type: String,
        enum: ['low', 'medium', 'high', 'urgent'],
        default: 'medium'
    },
    isRead: {
        type: Boolean,
        default: false
    },
    readAt: Date,
    actionRequired: Boolean,
    actionUrl: String
}, {
    timestamps: true
});

module.exports.Notification = mongoose.model('Notification', notificationSchema);

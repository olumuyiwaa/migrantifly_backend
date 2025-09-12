const mongoose = require('mongoose');
const consultationSchema = new mongoose.Schema({
    clientId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    adviserId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    type: {
        type: String,
        enum: ['initial', 'follow-up', 'appeal'],
        default: 'initial'
    },
    scheduledDate: {
        type: Date,
        required: true
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
        enum: ['scheduled', 'completed', 'cancelled', 'rescheduled'],
        default: 'scheduled'
    },
    notes: String,
    visaPathways: [String],
    clientToken: String,
    meetingLink: String
}, {
    timestamps: true
});

module.exports.Consultation = mongoose.model('Consultation', consultationSchema);

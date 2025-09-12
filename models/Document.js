
const documentSchema = new mongoose.Schema({
    applicationId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Application',
        required: true
    },
    clientId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    type: {
        type: String,
        required: true,
        enum: [
            'passport',
            'photo',
            'job_offer',
            'employment_contract',
            'financial_records',
            'bank_statements',
            'police_clearance',
            'medical_certificate',
            'qualification_documents',
            'marriage_certificate',
            'birth_certificate',
            'other'
        ]
    },
    name: {
        type: String,
        required: true
    },
    originalName: String,
    fileUrl: String,
    fileSize: Number,
    mimeType: String,
    status: {
        type: String,
        enum: ['pending', 'approved', 'rejected', 'under_review'],
        default: 'pending'
    },
    reviewNotes: String,
    reviewedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    reviewedAt: Date,
    isRequired: {
        type: Boolean,
        default: true
    },
    expiryDate: Date
}, {
    timestamps: true
});

module.exports.Document = mongoose.model('Document', documentSchema);

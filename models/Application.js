const applicationSchema = new mongoose.Schema({
    clientId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    adviserId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    consultationId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Consultation'
    },
    visaType: {
        type: String,
        enum: ['work', 'partner', 'student', 'residence', 'visitor', 'business'],
        required: true
    },
    stage: {
        type: String,
        enum: [
            'consultation',
            'deposit_paid',
            'documents_completed',
            'additional_docs_required',
            'submitted_to_inz',
            'inz_processing',
            'rfi_received',
            'ppi_received',
            'decision'
        ],
        default: 'consultation'
    },
    progress: {
        type: Number,
        min: 0,
        max: 100,
        default: 0
    },
    inzReference: String,
    submissionDate: Date,
    decisionDate: Date,
    outcome: {
        type: String,
        enum: ['approved', 'declined', 'pending']
    },
    decisionLetter: String,
    deadlines: [{
        type: {
            type: String,
            enum: ['rfi', 'ppi', 'medical', 'document']
        },
        description: String,
        dueDate: Date,
        completed: {
            type: Boolean,
            default: false
        }
    }],
    timeline: [{
        stage: String,
        date: Date,
        notes: String,
        updatedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        }
    }]
}, {
    timestamps: true
});

module.exports.Application = mongoose.model('Application', applicationSchema);

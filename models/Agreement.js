const agreementSchema = new mongoose.Schema({
    clientId: {
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
        enum: ['service_agreement', 'privacy_policy', 'terms_conditions'],
        required: true
    },
    version: {
        type: String,
        required: true
    },
    signedAt: {
        type: Date,
        required: true
    },
    ipAddress: String,
    documentUrl: String,
    digitalSignature: String
}, {
    timestamps: true
});

module.exports.Agreement = mongoose.model('Agreement', agreementSchema);
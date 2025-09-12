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
    amount: {
        type: Number,
        required: true
    },
    currency: {
        type: String,
        default: 'NZD'
    },
    type: {
        type: String,
        enum: ['deposit', 'final', 'additional', 'refund'],
        required: true
    },
    status: {
        type: String,
        enum: ['pending', 'completed', 'failed', 'refunded'],
        default: 'pending'
    },
    paymentMethod: {
        type: String,
        enum: ['credit_card', 'bank_transfer', 'paypal']
    },
    transactionId: String,
    gatewayReference: String,
    invoiceNumber: String,
    invoiceUrl: String,
    notes: String
}, {
    timestamps: true
});

module.exports.Payment = mongoose.model('Payment', paymentSchema);

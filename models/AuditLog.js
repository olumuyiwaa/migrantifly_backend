const auditLogSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    applicationId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Application'
    },
    action: {
        type: String,
        required: true
    },
    entityType: {
        type: String,
        enum: ['user', 'application', 'document', 'payment', 'consultation'],
        required: true
    },
    entityId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true
    },
    oldValues: mongoose.Schema.Types.Mixed,
    newValues: mongoose.Schema.Types.Mixed,
    ipAddress: String,
    userAgent: String
}, {
    timestamps: true
});

module.exports.AuditLog = mongoose.model('AuditLog', auditLogSchema);
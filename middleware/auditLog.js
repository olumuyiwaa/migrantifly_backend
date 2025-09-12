const auditLogger = (action, entityType) => {
    return async (req, res, next) => {
        const originalSend = res.send;

        res.send = function(data) {
            // Log successful actions
            if (res.statusCode < 400) {
                AuditLog.create({
                    userId: req.user?._id,
                    applicationId: req.params.applicationId || req.body.applicationId,
                    action,
                    entityType,
                    entityId: req.params.id || req.body._id,
                    oldValues: req.auditOldValues,
                    newValues: req.auditNewValues,
                    ipAddress: req.ip,
                    userAgent: req.get('User-Agent')
                }).catch(err => console.error('Audit log error:', err));
            }

            originalSend.call(this, data);
        };

        next();
    };
};

module.exports.auditLogger = auditLogger;
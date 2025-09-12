
const Joi = require('joi');

const validateRequest = (schema) => {
    return (req, res, next) => {
        const { error } = schema.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: 'Validation error',
                details: error.details.map(detail => detail.message)
            });
        }
        next();
    };
};

// Validation schemas
const schemas = {
    consultation: Joi.object({
        clientEmail: Joi.string().email().required(),
        clientName: Joi.string().min(2).max(100).required(),
        clientPhone: Joi.string().min(10).max(20).required(),
        preferredDate: Joi.date().min('now').required(),
        preferredTime: Joi.string().required(),
        method: Joi.string().valid('zoom', 'phone', 'in-person', 'google-meet').required(),
        message: Joi.string().max(500).optional()
    }),

    application: Joi.object({
        visaType: Joi.string().valid('work', 'partner', 'student', 'residence', 'visitor', 'business').required(),
        consultationId: Joi.string().required()
    }),

    profile: Joi.object({
        firstName: Joi.string().min(2).max(50).required(),
        lastName: Joi.string().min(2).max(50).required(),
        phone: Joi.string().min(10).max(20).optional(),
        dateOfBirth: Joi.date().max('now').optional(),
        nationality: Joi.string().min(2).max(50).optional(),
        address: Joi.object({
            street: Joi.string().max(200).optional(),
            city: Joi.string().max(100).optional(),
            state: Joi.string().max(100).optional(),
            country: Joi.string().max(100).optional(),
            postalCode: Joi.string().max(20).optional()
        }).optional()
    })
};

module.exports = { validateRequest, schemas };
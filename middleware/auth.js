const jwt = require('jsonwebtoken');
const User = require('../models/User');

const SWAGGER_BYPASS_PATHS = ['/api-docs','/api/docs', '/openapi.json'];

// Auth middleware with Swagger bypass
const auth = async (req, res, next) => {
    try {
        const url = req.originalUrl || req.url || '';
        if (SWAGGER_BYPASS_PATHS.some(p => url.startsWith(p))) {
            return next();
        }

        const token = req.header('Authorization')?.replace('Bearer ', '');
        if (!token) {
            return res.status(401).json({ success: false, message: 'Access denied. No token provided.' });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.userId).select('-password');

        if (!user || !user.isActive) {
            return res.status(401).json({ success: false, message: 'Invalid token or user inactive.' });
        }

        req.user = user;
        next();
    } catch {
        return res.status(401).json({ success: false, message: 'Invalid token.' });
    }
};

// Role-based access control
const authorize = (...roles) => {
    return (req, res, next) => {
        if (!req.user || !roles.includes(req.user.role)) {
            return res.status(403).json({ success: false, message: 'Access denied. Insufficient permissions.' });
        }
        next();
    };
};

module.exports = { auth, authorize };
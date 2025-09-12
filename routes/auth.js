const express = require('express');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const crypto = require('crypto');
const User = require('../models/User');
const { auth } = require('../middleware/auth');
const { sendEmail } = require('../utils/email');
const { generateToken } = require('../utils/tokenGenerator');

const router = express.Router();
// Rate limiting
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5 // limit each IP to 5 requests per windowMs
});

// Validation middleware
const setupAccountValidation = [
    body('password')
        .isLength({ min: 8 })
        .matches(/^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*#?&])[A-Za-z\d@$!%*#?&]{8,}$/)
        .withMessage('Password must be at least 8 characters long and contain letters, numbers, and special characters'),
    body('token').notEmpty().withMessage('Token is required'),
    body('profile').notEmpty().withMessage('Profile information is required')
];

// Generate client token after consultation
router.post('/generate-token', async (req, res) => {
    try {
        const { email, consultationId } = req.body;

        // Generate unique client token
        const clientToken = generateToken();

        // Store token temporarily (you might want to use Redis for this)
        const user = await User.findOneAndUpdate(
            { email },
            { token: clientToken },
            { upsert: true, new: true }
        );

        // Send email with account setup link
        const setupLink = `${process.env.FRONTEND_URL}/setup-account?token=${clientToken}`;

        await sendEmail({
            to: email,
            subject: 'Complete Your Migrantifly Account Setup',
            template: 'account-setup',
            data: {
                setupLink,
                consultationId
            }
        });

        res.status(200).json({
            success: true,
            message: 'Account setup link sent to email',
            token: clientToken
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error generating token',
            error: error.message
        });
    }
});

// Complete account setup
router.post('/setup-account', setupAccountValidation, async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                errors: errors.array()
            });
        }

        const { token, password, profile } = req.body;

        const user = await User.findOne({
            token,
            tokenExpiry: { $gt: new Date() }  // Check token expiration
        });

        if (!user) {
            return res.status(400).json({
                success: false,
                message: 'Invalid or expired token'
            });
        }

        // Update user
        user.password = password;
        user.profile = profile;
        user.token = undefined;
        user.tokenExpiry = undefined;
        user.isEmailVerified = true;
        await user.save();

        // Generate JWT with shorter expiration
        const jwtToken = jwt.sign(
            { userId: user._id, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }  // Reduced from 7d to 24h
        );

        res.status(200).json({
            success: true,
            message: 'Account setup completed',
            token: jwtToken,
            user: {
                id: user._id,
                email: user.email,
                role: user.role,
                profile: user.profile
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'An error occurred during account setup'
        });
    }
});


// Login
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        // Find user and include password for comparison
        const user = await User.findOne({ email }).select('+password');
        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials'
            });
        }

        // Check password
        const isMatch = await user.comparePassword(password);
        if (!isMatch) {
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials'
            });
        }

        if (!user.isActive) {
            return res.status(401).json({
                success: false,
                message: 'Account is deactivated'
            });
        }

        // Generate JWT
        const token = jwt.sign(
            { userId: user._id, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.status(200).json({
            success: true,
            message: 'Login successful',
            token,
            user: {
                id: user._id,
                email: user.email,
                role: user.role,
                profile: user.profile
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error logging in',
            error: error.message
        });
    }
});

// Get current user
router.get('/me', auth, async (req, res) => {
    res.status(200).json({
        success: true,
        user: req.user
    });
});

// Logout (client-side token removal, but we can blacklist tokens if needed)
router.post('/logout', auth, (req, res) => {
    res.status(200).json({
        success: true,
        message: 'Logged out successfully'
    });
});

module.exports = router;


const express = require('express');
const { Application, Document, Payment, Agreement, Notification, User } = require('../models');
const { auth, authorize } = require('../middleware/auth');

const router = express.Router();

// Get client dashboard
router.get('/dashboard', auth, authorize('client'), async (req, res) => {
    try {
        const clientId = req.user._id;

        // Get active applications
        const applications = await Application.find({ clientId })
            .populate('adviserId', 'email profile')
            .sort({ createdAt: -1 });

        // Get pending notifications
        const notifications = await Notification.find({
            userId: clientId,
            isRead: false
        })
            .sort({ createdAt: -1 })
            .limit(5);

        // Get upcoming deadlines
        const upcomingDeadlines = [];
        applications.forEach(app => {
            const deadlines = app.deadlines.filter(
                deadline => !deadline.completed && new Date(deadline.dueDate) > new Date()
            );
            upcomingDeadlines.push(...deadlines.map(d => ({ ...d.toObject(), applicationId: app._id })));
        });

        // Sort deadlines by due date
        upcomingDeadlines.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));

        // Get recent payments
        const payments = await Payment.find({ clientId })
            .sort({ createdAt: -1 })
            .limit(3);

        res.status(200).json({
            success: true,
            data: {
                applications,
                notifications,
                upcomingDeadlines: upcomingDeadlines.slice(0, 3),
                recentPayments: payments,
                summary: {
                    totalApplications: applications.length,
                    activeApplications: applications.filter(app => app.stage !== 'decision').length,
                    unreadNotifications: notifications.length,
                    pendingDeadlines: upcomingDeadlines.length
                }
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error fetching dashboard data',
            error: error.message
        });
    }
});

// Update profile
router.patch('/profile', auth, async (req, res) => {
    try {
        const { profile } = req.body;

        const user = await User.findByIdAndUpdate(
          req.user._id,
          { profile },
          { new: true, runValidators: true }
        ).select('-password');

        res.status(200).json({
            success: true,
            message: 'Profile updated successfully',
            data: user
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error updating profile',
            error: error.message
        });
    }
});

module.exports = router;

/**
 * @openapi
 * tags:
 *   - name: Client
 *     description: Client portal endpoints
 *
 * /api/client/dashboard:
 *   get:
 *     tags: [Client]
 *     summary: Get client dashboard data
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Dashboard data returned }
 *       401: { description: Unauthorized }
 *
 * /api/client/profile:
 *   patch:
 *     tags: [Client]
 *     summary: Update client profile
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               profile:
 *                 type: object
 *                 additionalProperties: true
 *             required: [profile]
 *     responses:
 *       200: { description: Profile updated }
 *       401: { description: Unauthorized }
 */
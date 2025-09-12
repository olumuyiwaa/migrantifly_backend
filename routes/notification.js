const express = require('express');
const { Notification } = require('../models');
const { auth } = require('../middleware/auth');

const router = express.Router();

// Get user's notifications
router.get('/', auth, async (req, res) => {
    try {
        const { page = 1, limit = 20, unreadOnly = false } = req.query;

        const filter = { userId: req.user._id };
        if (unreadOnly === 'true') {
            filter.isRead = false;
        }

        const notifications = await Notification.find(filter)
            .sort({ createdAt: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit);

        const total = await Notification.countDocuments(filter);
        const unreadCount = await Notification.countDocuments({
            userId: req.user._id,
            isRead: false
        });

        res.status(200).json({
            success: true,
            data: {
                notifications,
                totalPages: Math.ceil(total / limit),
                currentPage: page,
                total,
                unreadCount
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error fetching notifications',
            error: error.message
        });
    }
});

// Mark notification as read
router.patch('/:id/read', auth, async (req, res) => {
    try {
        const notification = await Notification.findOneAndUpdate(
            { _id: req.params.id, userId: req.user._id },
            { isRead: true, readAt: new Date() },
            { new: true }
        );

        if (!notification) {
            return res.status(404).json({
                success: false,
                message: 'Notification not found'
            });
        }

        res.status(200).json({
            success: true,
            data: notification
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error marking notification as read',
            error: error.message
        });
    }
});

// Mark all notifications as read
router.patch('/mark-all-read', auth, async (req, res) => {
    try {
        await Notification.updateMany(
            { userId: req.user._id, isRead: false },
            { isRead: true, readAt: new Date() }
        );

        res.status(200).json({
            success: true,
            message: 'All notifications marked as read'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error marking notifications as read',
            error: error.message
        });
    }
});

// Delete notification
router.delete('/:id', auth, async (req, res) => {
    try {
        const notification = await Notification.findOneAndDelete({
            _id: req.params.id,
            userId: req.user._id
        });

        if (!notification) {
            return res.status(404).json({
                success: false,
                message: 'Notification not found'
            });
        }

        res.status(200).json({
            success: true,
            message: 'Notification deleted'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error deleting notification',
            error: error.message
        });
    }
});

module.exports = router;
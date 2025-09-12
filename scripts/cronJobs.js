
const cron = require('node-cron');
const { sendDeadlineReminders } = require('../utils/notifications');
const { Application } = require('../models');
const logger = require('../utils/logger');

// Run deadline reminders every day at 9 AM
cron.schedule('0 9 * * *', async () => {
    logger.info('Running deadline reminder job');
    try {
        await sendDeadlineReminders();
        logger.info('Deadline reminders sent successfully');
    } catch (error) {
        logger.error('Error sending deadline reminders:', error);
    }
});

// Clean up expired tokens every day at midnight
cron.schedule('0 0 * * *', async () => {
    logger.info('Running token cleanup job');
    try {
        const User = require('../models/User');
        const oneDayAgo = new Date();
        oneDayAgo.setDate(oneDayAgo.getDate() - 1);

        await User.updateMany(
            {
                token: { $exists: true },
                updatedAt: { $lt: oneDayAgo }
            },
            { $unset: { token: 1 } }
        );

        logger.info('Expired tokens cleaned up successfully');
    } catch (error) {
        logger.error('Error cleaning up tokens:', error);
    }
});

console.log('Cron jobs initialized');

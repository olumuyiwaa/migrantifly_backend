
const { Notification } = require('../models');
const { sendEmail } = require('./email');

const sendNotification = async ({
                                    userId,
                                    applicationId,
                                    type,
                                    title,
                                    message,
                                    priority = 'medium',
                                    actionRequired = false,
                                    actionUrl = null,
                                    emailNotification = true
                                }) => {
    try {
        // Create notification in database
        const notification = new Notification({
            userId,
            applicationId,
            type,
            title,
            message,
            priority,
            actionRequired,
            actionUrl
        });

        await notification.save();

        // Send email notification if enabled
        if (emailNotification && (priority === 'high' || priority === 'urgent' || actionRequired)) {
            const User = require('../models/User');
            const user = await User.findById(userId);

            if (user && user.email) {
                await sendEmail({
                    to: user.email,
                    subject: `Migrantifly - ${title}`,
                    template: 'notification',
                    data: {
                        clientName: `${user.profile.firstName} ${user.profile.lastName}`,
                        title,
                        message,
                        actionUrl: actionUrl || `${process.env.FRONTEND_URL}/dashboard`,
                        priority
                    }
                });
            }
        }

        return notification;
    } catch (error) {
        console.error('Error sending notification:', error);
        throw error;
    }
};

// Send deadline reminders
const sendDeadlineReminders = async () => {
    try {
        const Application = require('../models').Application;
        const threeDaysFromNow = new Date();
        threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);

        // Find applications with approaching deadlines
        const applications = await Application.find({
            'deadlines.dueDate': { $lte: threeDaysFromNow },
            'deadlines.completed': false
        }).populate('clientId');

        for (const application of applications) {
            const upcomingDeadlines = application.deadlines.filter(
                deadline => !deadline.completed && new Date(deadline.dueDate) <= threeDaysFromNow
            );

            for (const deadline of upcomingDeadlines) {
                const daysUntilDue = Math.ceil(
                    (new Date(deadline.dueDate) - new Date()) / (1000 * 60 * 60 * 24)
                );

                await sendNotification({
                    userId: application.clientId._id,
                    applicationId: application._id,
                    type: 'deadline_approaching',
                    title: 'Deadline Approaching',
                    message: `Your ${deadline.type.toUpperCase()} response is due in ${daysUntilDue} day(s). Please submit your documents promptly.`,
                    priority: daysUntilDue <= 1 ? 'urgent' : 'high',
                    actionRequired: true,
                    actionUrl: `/applications/${application._id}/documents`
                });
            }
        }
    } catch (error) {
        console.error('Error sending deadline reminders:', error);
    }
};

module.exports = { sendNotification, sendDeadlineReminders };
const nodemailer = require('nodemailer');
const handlebars = require('handlebars');
const fs = require('fs').promises;
const path = require('path');

// Validate required environment variables
const validateConfig = () => {
    const required = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'FROM_EMAIL'];
    const missing = required.filter(key => !process.env[key]);

    if (missing.length > 0) {
        throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }
};

// Create transporter with error handling
const createTransporter = () => {
    try {
        validateConfig();

        const config = {
            host: process.env.SMTP_HOST,
            port: Number(process.env.SMTP_PORT) || 587,
            secure: Number(process.env.SMTP_PORT) === 465,
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS
            },
            connectionTimeout: 10000,
            greetingTimeout: 10000,
            socketTimeout: 20000,
            logger: process.env.NODE_ENV === 'development', // Enable logging in dev
            debug: process.env.NODE_ENV === 'development'
        };

        // Gmail-specific configuration
        if (process.env.SMTP_HOST?.includes('gmail')) {
            config.service = 'gmail';
            config.tls = {
                rejectUnauthorized: true
            };
        } else {
            // Generic SMTP settings
            config.requireTLS = true;
            config.tls = {
                minVersion: 'TLSv1.2',
                rejectUnauthorized: process.env.NODE_ENV === 'production'
            };
        }

        return nodemailer.createTransport(config);
    } catch (error) {
        console.error('Failed to create email transporter:', error);
        throw error;
    }
};

const transporter = createTransporter();

// Verify transporter connection on startup
const verifyConnection = async () => {
    try {
        await transporter.verify();
        console.log('✓ Email service is ready to send emails');
        return true;
    } catch (error) {
        console.error('✗ Email service connection failed:', error.message);

        // Provide helpful error messages
        if (error.code === 'EAUTH') {
            console.error('Authentication failed. Check your SMTP credentials.');
            console.error('For Gmail: Make sure you\'re using an App Password, not your regular password.');
        } else if (error.code === 'ESOCKET') {
            console.error('Socket connection failed. Check your SMTP host and port.');
        } else if (error.code === 'ETIMEDOUT') {
            console.error('Connection timed out. Check your network or firewall settings.');
        }

        return false;
    }
};

// Call verification on module load (non-blocking)
verifyConnection().catch(err => {
    console.warn('Email verification skipped:', err.message);
});

// Cache for compiled templates
const templateCache = new Map();

// Load and compile email templates
const loadTemplate = async (templateName) => {
    try {
        // Check cache first
        if (templateCache.has(templateName)) {
            return templateCache.get(templateName);
        }

        const templatePath = path.join(__dirname, '../templates', `${templateName}.hbs`);
        const templateContent = await fs.readFile(templatePath, 'utf8');
        const compiled = handlebars.compile(templateContent);

        // Cache the compiled template
        templateCache.set(templateName, compiled);

        return compiled;
    } catch (error) {
        console.error(`Error loading template ${templateName}:`, error);
        throw new Error(`Email template "${templateName}" not found`);
    }
};

// Send email function with retry logic
const sendEmail = async ({
    to,
    subject,
    template,
    data,
    html,
    text,
    attachments,
    cc,
    bcc,
    replyTo
}, retries = 3) => {
    // Validate required fields
    if (!to || !subject) {
        throw new Error('Email recipient (to) and subject are required');
    }

    if (!template && !html && !text) {
        throw new Error('Either template, html, or text must be provided');
    }

    let emailHtml = html;
    let emailText = text;

    try {
        // If template is provided, use it
        if (template && !html) {
            const compiledTemplate = await loadTemplate(template);
            emailHtml = compiledTemplate(data || {});
        }

        // Generate plain text from HTML if not provided
        if (emailHtml && !emailText) {
            emailText = emailHtml.replace(/<[^>]*>/g, ''); // Simple HTML stripping
        }

        const mailOptions = {
            from: `"${process.env.FROM_NAME || 'Migrantifly'}" <${process.env.FROM_EMAIL}>`,
            to,
            subject,
            html: emailHtml,
            text: emailText
        };

        // Optional fields
        if (cc) mailOptions.cc = cc;
        if (bcc) mailOptions.bcc = bcc;
        if (replyTo) mailOptions.replyTo = replyTo;
        if (attachments) mailOptions.attachments = attachments;

        const info = await transporter.sendMail(mailOptions);

        console.log(`✓ Email sent successfully to ${to}`);
        console.log(`  Message ID: ${info.messageId}`);

        return {
            success: true,
            messageId: info.messageId,
            response: info.response
        };

    } catch (error) {
        console.error(`✗ Error sending email to ${to}:`, error.message);

        // Retry logic for transient errors
        if (retries > 0 && isRetriableError(error)) {
            console.log(`  Retrying... (${retries} attempts left)`);
            await sleep(2000); // Wait 2 seconds before retry
            return sendEmail({ to, subject, template, data, html, text, attachments, cc, bcc, replyTo }, retries - 1);
        }

        // Log detailed error info
        logEmailError(error, to);

        throw error;
    }
};

// Check if error is retriable
const isRetriableError = (error) => {
    const retriableCodes = ['ETIMEDOUT', 'ECONNRESET', 'ESOCKET', 'ENOTFOUND'];
    return retriableCodes.includes(error.code);
};

// Sleep utility for retry
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Log detailed error information
const logEmailError = (error, recipient) => {
    console.error('Email Error Details:');
    console.error(`  Recipient: ${recipient}`);
    console.error(`  Code: ${error.code || 'N/A'}`);
    console.error(`  Command: ${error.command || 'N/A'}`);

    if (error.code === 'EAUTH') {
        console.error('\n  Troubleshooting:');
        console.error('  - For Gmail: Enable 2FA and use an App Password');
        console.error('  - Generate App Password: https://myaccount.google.com/apppasswords');
        console.error('  - Make sure "Less secure app access" is not needed with App Passwords');
    } else if (error.code === 'EENVELOPE') {
        console.error('\n  Troubleshooting:');
        console.error('  - Check that FROM_EMAIL is valid and verified');
        console.error('  - Check that recipient email is valid');
    }
};

// Bulk email sending with rate limiting
const sendBulkEmails = async (emails, delayMs = 1000) => {
    const results = [];

    for (let i = 0; i < emails.length; i++) {
        try {
            const result = await sendEmail(emails[i]);
            results.push({ index: i, success: true, ...result });
        } catch (error) {
            results.push({
                index: i,
                success: false,
                error: error.message,
                recipient: emails[i].to
            });
        }

        // Delay between emails to avoid rate limiting
        if (i < emails.length - 1) {
            await sleep(delayMs);
        }
    }

    const successful = results.filter(r => r.success).length;
    console.log(`Bulk email complete: ${successful}/${emails.length} sent successfully`);

    return results;
};

// Test email function for debugging
const sendTestEmail = async (to) => {
    try {
        console.log('Sending test email...');
        console.log(`SMTP Host: ${process.env.SMTP_HOST}`);
        console.log(`SMTP Port: ${process.env.SMTP_PORT}`);
        console.log(`SMTP User: ${process.env.SMTP_USER}`);
        console.log(`From Email: ${process.env.FROM_EMAIL}`);

        const result = await sendEmail({
            to,
            subject: 'Test Email - Migrantifly',
            html: '<h1>Test Email</h1><p>If you received this, your email service is working correctly!</p>',
            text: 'Test Email - If you received this, your email service is working correctly!'
        });

        console.log('✓ Test email sent successfully!');
        return result;
    } catch (error) {
        console.error('✗ Test email failed:', error);
        throw error;
    }
};

module.exports = {
    sendEmail,
    sendBulkEmails,
    sendTestEmail,
    verifyConnection,
    transporter
};
const { Resend } = require('resend');
const handlebars = require('handlebars');
const fs = require('fs').promises;
const path = require('path');

// Initialize Resend
const resend = new Resend(process.env.RESEND_API_KEY);

// Validate configuration
const validateConfig = () => {
    if (!process.env.RESEND_API_KEY) {
        throw new Error('Missing RESEND_API_KEY environment variable');
    }
    if (!process.env.FROM_EMAIL) {
        console.warn('FROM_EMAIL not set, using default: onboarding@resend.dev');
    }
};

validateConfig();

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

// Send email using Resend
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

        // Prepare email payload
        const emailData = {
            from: `${process.env.FROM_NAME || 'Migrantifly'} <${process.env.FROM_EMAIL || 'onboarding@resend.dev'}>`,
            to: Array.isArray(to) ? to : [to],
            subject,
            html: emailHtml
        };

        // Optional fields
        if (emailText) emailData.text = emailText;
        if (cc) emailData.cc = Array.isArray(cc) ? cc : [cc];
        if (bcc) emailData.bcc = Array.isArray(bcc) ? bcc : [bcc];
        if (replyTo) emailData.reply_to = replyTo;

        if (attachments) {
            emailData.attachments = attachments.map(att => ({
                filename: att.filename,
                content: att.content
            }));
        }

        // Send email via Resend
        const response = await resend.emails.send(emailData);

        if (response.error) {
            throw new Error(response.error.message);
        }

        console.log(`✓ Email sent successfully to ${Array.isArray(to) ? to.join(', ') : to}`);
        console.log(`  Email ID: ${response.data.id}`);

        return {
            success: true,
            id: response.data.id
        };

    } catch (error) {
        console.error(`✗ Error sending email to ${to}:`, error.message);

        // Retry logic for transient errors
        if (retries > 0 && isRetriableError(error)) {
            console.log(`  Retrying... (${retries} attempts left)`);
            await sleep(2000);
            return sendEmail({ to, subject, template, data, html, text, attachments, cc, bcc, replyTo }, retries - 1);
        }

        // Log detailed error
        logEmailError(error, to);
        throw error;
    }
};

// Check if error is retriable
const isRetriableError = (error) => {
    const retriableMessages = ['timeout', 'network', 'ECONNRESET', 'ETIMEDOUT'];
    return retriableMessages.some(msg => error.message?.toLowerCase().includes(msg));
};

// Sleep utility
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Log detailed error information
const logEmailError = (error, recipient) => {
    console.error('Email Error Details:');
    console.error(`  Recipient: ${recipient}`);
    console.error(`  Error: ${error.message}`);

    if (error.message?.includes('Invalid API key')) {
        console.error('\n  Troubleshooting:');
        console.error('  - Check that RESEND_API_KEY is set correctly');
        console.error('  - Make sure the API key starts with "re_"');
    } else if (error.message?.includes('not verified')) {
        console.error('\n  Troubleshooting:');
        console.error('  - Verify your domain in Resend dashboard');
        console.error('  - Or use onboarding@resend.dev for testing');
    }
};

// Bulk email sending with rate limiting
const sendBulkEmails = async (emails, delayMs = 100) => {
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

        // Delay between emails
        if (i < emails.length - 1) {
            await sleep(delayMs);
        }
    }

    const successful = results.filter(r => r.success).length;
    console.log(`Bulk email complete: ${successful}/${emails.length} sent successfully`);

    return results;
};

// Test email function
const sendTestEmail = async (to) => {
    try {
        console.log('Sending test email via Resend...');
        console.log(`From Email: ${process.env.FROM_EMAIL || 'onboarding@resend.dev'}`);
        console.log(`To: ${to}`);

        const result = await sendEmail({
            to,
            subject: 'Test Email - Migrantifly',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                    <h1 style="color: #4CAF50;">Email Service Working!</h1>
                    <p>If you received this, your Resend email service is configured correctly.</p>
                    <p style="color: #666;">Sent via Resend API</p>
                    <hr style="margin: 20px 0; border: none; border-top: 1px solid #ddd;">
                    <p style="color: #999; font-size: 12px;">Migrantifly - Immigration Management System</p>
                </div>
            `,
            text: 'Test Email - If you received this, your Resend email service is working correctly!'
        });

        console.log('✓ Test email sent successfully!');
        return result;
    } catch (error) {
        console.error('✗ Test email failed:', error);
        throw error;
    }
};

// Verify Resend configuration
const verifyConnection = async () => {
    try {
        if (!process.env.RESEND_API_KEY) {
            throw new Error('RESEND_API_KEY not configured');
        }
        if (!process.env.RESEND_API_KEY.startsWith('re_')) {
            console.warn('⚠️  Warning: RESEND_API_KEY should start with "re_"');
        }
        console.log('✓ Resend API key is configured');
        return true;
    } catch (error) {
        console.error('✗ Resend configuration error:', error.message);
        return false;
    }
};

verifyConnection();

module.exports = {
    sendEmail,
    sendBulkEmails,
    sendTestEmail,
    verifyConnection
};

// gmail pass= mqqy irpu czeq tfgn
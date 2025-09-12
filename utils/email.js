const nodemailer = require('nodemailer');
const handlebars = require('handlebars');
const fs = require('fs').promises;
const path = require('path');

// Create transporter
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: Number(process.env.SMTP_PORT) === 465, // true for 465, false for other ports
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    }
});


// Load and compile email templates
const loadTemplate = async (templateName) => {
    try {
        const templatePath = path.join(__dirname, '../templates', `${templateName}.hbs`);
        const templateContent = await fs.readFile(templatePath, 'utf8');
        return handlebars.compile(templateContent);
    } catch (error) {
        console.error(`Error loading template ${templateName}:`, error);
        return null;
    }
};

// Send email function

const sendEmail = async ({ to, subject, template, data, html, text }) => {
    try {
        let emailHtml = html;
        let emailText = text;

        // If template is provided, use it
        if (template && !html) {
            const compiledTemplate = await loadTemplate(template);
            if (compiledTemplate) {
                emailHtml = compiledTemplate(data);
            } else {
                throw new Error(`Template ${template} not found`);
            }
        }

        const mailOptions = {
            from: `"Migrantifly" <${process.env.FROM_EMAIL}>`,
            to,
            subject,
            html: emailHtml,
            text: emailText
        };

        const info = await transporter.sendMail(mailOptions);
        console.log('Email sent:', info.messageId);
        return info;
    } catch (error) {
        console.error('Error sending email:', error);
        throw error;
    }
};

module.exports = { sendEmail };


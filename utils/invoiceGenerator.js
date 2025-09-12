const PDFDocument = require('pdfkit');
const fs = require('fs').promises;
const path = require('path');

const generateInvoice = async ({ payment, client, invoiceNumber }) => {
    try {
        const doc = new PDFDocument({ margin: 50 });
        const invoiceDir = path.join(__dirname, '../invoices');

        // Ensure directory exists
        try {
            await fs.mkdir(invoiceDir, { recursive: true });
        } catch (err) {
            // Directory might already exist
        }

        const filename = `invoice-${invoiceNumber}.pdf`;
        const filepath = path.join(invoiceDir, filename);

        doc.pipe(require('fs').createWriteStream(filepath));

        // Header
        doc.fontSize(20)
            .text('INVOICE', { align: 'center' })
            .moveDown();

        // Company details
        doc.fontSize(12)
            .text('Migrantifly Immigration Services')
            .text('Auckland, New Zealand')
            .text('Email: info@migrantifly.com')
            .text('Phone: +64 XXX XXXX')
            .moveDown();

        // Invoice details
        doc.text(`Invoice Number: ${invoiceNumber}`)
            .text(`Date: ${new Date().toLocaleDateString()}`)
            .text(`Due Date: ${new Date().toLocaleDateString()}`)
            .moveDown();

        // Bill to
        doc.text('Bill To:')
            .text(`${client.profile.firstName} ${client.profile.lastName}`)
            .text(client.email)
            .moveDown();

        // Services
        doc.text('Services:')
            .moveDown(0.5);

        const serviceDescription = payment.type === 'deposit' ?
            'Immigration Service Deposit (10%)' :
            'Immigration Service Payment';

        doc.text(`${serviceDescription}: ${payment.currency} $${payment.amount}`)
            .moveDown();

        // Total
        doc.fontSize(14)
            .text(`Total: ${payment.currency} $${payment.amount}`, { align: 'right' })
            .moveDown();

        // Footer
        doc.fontSize(10)
            .text('Thank you for choosing Migrantifly Immigration Services!', { align: 'center' });

        doc.end();

        // Wait for PDF to be written
        await new Promise((resolve) => {
            doc.on('end', resolve);
        });

        // Upload to cloud storage and return URL
        const { uploadToCloudStorage } = require('./fileStorage');
        const invoiceUrl = await uploadToCloudStorage(filepath, {
            folder: 'invoices',
            filename
        });

        // Clean up local file
        await fs.unlink(filepath);

        return invoiceUrl;
    } catch (error) {
        console.error('Error generating invoice:', error);
        throw error;
    }
};

module.exports = { generateInvoice };
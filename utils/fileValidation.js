
const fs = require('fs').promises;
const path = require('path');

const validateFile = async (filePath) => {
    try {
        const stats = await fs.stat(filePath);
        const fileSize = stats.size;
        const maxSize = 10 * 1024 * 1024; // 10MB

        if (fileSize > maxSize) {
            return {
                isValid: false,
                error: 'File size exceeds 10MB limit'
            };
        }

        // Check file extension
        const allowedExtensions = ['.jpg', '.jpeg', '.png', '.pdf', '.doc', '.docx'];
        const fileExtension = path.extname(filePath).toLowerCase();

        if (!allowedExtensions.includes(fileExtension)) {
            return {
                isValid: false,
                error: 'File type not supported'
            };
        }

        return { isValid: true };
    } catch (error) {
        return {
            isValid: false,
            error: 'Error validating file'
        };
    }
};

const scanForVirus = async (filePath) => {
    try {
        // Placeholder for virus scanning
        // In production, integrate with ClamAV or similar service
        // For now, just return clean
        return { isClean: true };
    } catch (error) {
        console.error('Error scanning file:', error);
        return { isClean: false };
    }
};

module.exports = { validateFile, scanForVirus };
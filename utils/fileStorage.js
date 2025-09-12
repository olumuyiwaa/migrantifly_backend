
const AWS = require('aws-sdk');
const fs = require('fs').promises;
const path = require('path');

// Configure AWS S3
const s3 = new AWS.S3({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION || 'ap-southeast-2'
});

const uploadToCloudStorage = async (filePath, options = {}) => {
    try {
        const fileContent = await fs.readFile(filePath);
        const fileName = options.filename || path.basename(filePath);
        const folder = options.folder || 'documents';

        const params = {
            Bucket: process.env.AWS_S3_BUCKET,
            Key: `${folder}/${fileName}`,
            Body: fileContent,
            ServerSideEncryption: 'AES256',
            Metadata: {
                uploadedAt: new Date().toISOString(),
                originalName: path.basename(filePath)
            }
        };

        const result = await s3.upload(params).promise();
        return result.Location;
    } catch (error) {
        console.error('Error uploading to cloud storage:', error);
        throw error;
    }
};

const deleteFromCloudStorage = async (fileUrl) => {
    try {
        const key = fileUrl.split('/').slice(-2).join('/'); // Extract key from URL

        const params = {
            Bucket: process.env.AWS_S3_BUCKET,
            Key: key
        };

        await s3.deleteObject(params).promise();
        console.log('File deleted from cloud storage:', key);
    } catch (error) {
        console.error('Error deleting from cloud storage:', error);
        throw error;
    }
};

const generateSecureDownloadUrl = async (fileUrl, expiresIn = 3600) => {
    try {
        const key = fileUrl.split('/').slice(-2).join('/');

        const params = {
            Bucket: process.env.AWS_S3_BUCKET,
            Key: key,
            Expires: expiresIn
        };

        return s3.getSignedUrl('getObject', params);
    } catch (error) {
        console.error('Error generating download URL:', error);
        throw error;
    }
};

module.exports = {
    uploadToCloudStorage,
    deleteFromCloudStorage,
    generateSecureDownloadUrl
};

const AWS = require('aws-sdk');
const { v2: cloudinary } = require('cloudinary');
const fs = require('fs').promises;
const path = require('path');
const url = require('url');

// Configure AWS S3
const s3 = new AWS.S3({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION || 'ap-southeast-2'
});

// Configure Cloudinary from environment
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
});

// Decide resource_type for Cloudinary
function pickResourceType(filePathOrMime) {
    const imageMimes = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
    if (imageMimes.has(filePathOrMime)) return 'image';
    const ext = path.extname(filePathOrMime || '').toLowerCase();
    const imageExts = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);
    return imageExts.has(ext) ? 'image' : 'raw';
}



function splitNameAndExt(filename) {
    const ext = path.extname(filename || '');
    const base = filename ? filename.slice(0, -ext.length) : '';
    return { base, ext: ext.replace(/^\./, '') };
}

function parseCloudinaryUrl(fileUrl) {
    const { pathname } = new url.URL(fileUrl);
    const parts = pathname.split('/').filter(Boolean);

    // Find resource type segment (image|video|raw)
    const rtIdx = parts.findIndex(p => ['image', 'video', 'raw'].includes(p));
    const resourceType = rtIdx >= 0 ? parts[rtIdx] : 'raw';
    const type = rtIdx >= 0 && parts[rtIdx + 1] ? parts[rtIdx + 1] : 'private';

    const afterType = parts.slice(rtIdx + 2);
    const withoutVersion = afterType[0] && /^v\d+$/i.test(afterType[0])
      ? afterType.slice(1)
      : afterType;

    const last = withoutVersion[withoutVersion.length - 1] || '';
    const dot = last.lastIndexOf('.');
    const format = dot >= 0 ? last.slice(dot + 1) : '';
    const lastNoExt = dot >= 0 ? last.slice(0, dot) : last;
    const publicId = [...withoutVersion.slice(0, -1), lastNoExt].join('/');

    return { resourceType, type, publicId, format };
}

// const uploadToCloudStorage = async (filePath, options = {}) => {
//     try {
//         const fileContent = await fs.readFile(filePath);
//         const fileName = options.filename || path.basename(filePath);
//         const folder = options.folder || 'documents';
//
//         const params = {
//             Bucket: process.env.AWS_S3_BUCKET,
//             Key: `${folder}/${fileName}`,
//             Body: fileContent,
//             ServerSideEncryption: 'AES256',
//             Metadata: {
//                 uploadedAt: new Date().toISOString(),
//                 originalName: path.basename(filePath)
//             }
//         };
//
//         const result = await s3.upload(params).promise();
//         return result.Location;
//     } catch (error) {
//         console.error('Error uploading to cloud storage:', error);
//         throw error;
//     }
// };
//
// const deleteFromCloudStorage = async (fileUrl) => {
//     try {
//         const key = fileUrl.split('/').slice(-2).join('/'); // Extract key from URL
//
//         const params = {
//             Bucket: process.env.AWS_S3_BUCKET,
//             Key: key
//         };
//
//         await s3.deleteObject(params).promise();
//         console.log('File deleted from cloud storage:', key);
//     } catch (error) {
//         console.error('Error deleting from cloud storage:', error);
//         throw error;
//     }
// };
//
// const generateSecureDownloadUrl = async (fileUrl, expiresIn = 3600) => {
//     try {
//         const key = fileUrl.split('/').slice(-2).join('/');
//
//         const params = {
//             Bucket: process.env.AWS_S3_BUCKET,
//             Key: key,
//             Expires: expiresIn
//         };
//
//         return s3.getSignedUrl('getObject', params);
//     } catch (error) {
//         console.error('Error generating download URL:', error);
//         throw error;
//     }
// };

function sanitizePublicId(name) {
    return name
      .replace(/[^\w\-./]/g, '-')   // allow letters, numbers, _, -, ., /
      .replace(/-{2,}/g, '-')
      .replace(/^\.+|\.+$/g, '');   // trim leading/trailing dots
}

async function uploadToCloudStorage(localFilePath, { folder = 'uploads', filename, mimeType } = {}) {
    const resource_type = pickResourceType(mimeType || localFilePath);
    const desiredName = filename || path.basename(localFilePath);
    const { base } = splitNameAndExt(desiredName);

    const public_id = sanitizePublicId([folder, base].filter(Boolean).join('/'));

    const result = await cloudinary.uploader.upload(localFilePath, {
        resource_type,
        public_id,
        type: 'private',
        overwrite: true,
        invalidate: true,
    });

    return result.secure_url;
}


async function deleteFromCloudStorage(fileUrl) {
    if (!fileUrl) return;
    const { resourceType, type, publicId } = parseCloudinaryUrl(fileUrl);

    try {
        const res = await cloudinary.uploader.destroy(publicId, {
            resource_type: resourceType,
            type: type || 'private',
            invalidate: true,
        });
        // Some raw assets need API delete
        if (res.result === 'not found' && resourceType === 'raw') {
            await cloudinary.api.delete_resources([publicId], {
                resource_type: 'raw',
                type: type || 'private',
            });
        }
    } catch {
        // swallow errors here; log at call site if desired
    }
}

function generateSecureDownloadUrl(fileUrl, { expiresInSeconds = 3600, attachment = true } = {}) {
    const { resourceType, publicId, format } = parseCloudinaryUrl(fileUrl);
    const expires_at = Math.floor(Date.now() / 1000) + Math.max(1, expiresInSeconds);

    // Works for assets uploaded with type='private'
    return cloudinary.utils.private_download_url(publicId, format || undefined, {
        resource_type: resourceType,
        expires_at,
        attachment,
    });
}

module.exports = {
    uploadToCloudStorage,
    deleteFromCloudStorage,
    generateSecureDownloadUrl,
};

const crypto = require('crypto');

const generateToken = (length = 32) => {
    return crypto.randomBytes(length).toString('hex');
};

const generateClientToken = () => {
    // Generate a more user-friendly token format
    const timestamp = Date.now().toString(36);
    const randomPart = crypto.randomBytes(4).toString('hex').toUpperCase();
    return `MF-${timestamp}-${randomPart}`;
};

module.exports = { generateToken, generateClientToken };

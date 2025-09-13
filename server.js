const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const morgan = require('morgan');
const dotenv = require('dotenv');

const swaggerUi = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');

// Load environment variables
dotenv.config();

// Import routes
const authRoutes = require('./routes/auth');
const clientRoutes = require('./routes/client');
const adminRoutes = require('./routes/admin');
const consultationRoutes = require('./routes/consultation');
const documentRoutes = require('./routes/document');
const paymentRoutes = require('./routes/payment');
const applicationRoutes = require('./routes/application');
const notificationRoutes = require('./routes/notification');

// Import middleware
const { auth } = require('./middleware/auth');
const errorHandler = require('./middleware/errorHandler');
const logger = require('./utils/logger');

const app = express();
const swaggerOptions = {
    definition: {
        openapi: '3.0.3',
        info: {
            title: 'Migrantifly API',
            version: '1.0.0',
            description: 'API documentation for Migrantifly backend',
        },
        servers: [
            { url: process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 5000}` },
        ],
        components: {
            securitySchemes: {
                bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
            },
        },
        security: [{ bearerAuth: [] }],
    },
    // Point this to files where you’ll write JSDoc annotations
    apis: ['./server.js', './routes/*.js'],
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);


function assertMiddleware(name, mw) {
    const isFn = typeof mw === 'function';
    const isArrayOfFns = Array.isArray(mw) && mw.every(item => typeof item === 'function');

    if (!isFn && !isArrayOfFns) {
        console.error(`[Startup] ${name} is not a middleware function. typeof: ${Array.isArray(mw) ? 'array' : typeof mw}`);
    }
    return mw;
}


// Security middleware
app.use(assertMiddleware ('helmet',helmet()));
app.use(assertMiddleware ('compression',compression()));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP, please try again later.'
});
app.use(assertMiddleware('rateLimit', limiter));

// CORS configuration
app.use(assertMiddleware ('cors',cors({
    origin: '*',
    methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
    allowedHeaders: ['Content-Type','Authorization'],
})));
app.options('*', (req, res) => res.sendStatus(200));

// Body parsing middleware
app.use(assertMiddleware('express.json', express.json({ limit: '10mb' })));
app.use(assertMiddleware('express.urlencoded', express.urlencoded({ extended: true, limit: '10mb' })));

// Logging
app.use(assertMiddleware('morgan', morgan('combined', { stream: { write: message => logger.info(message.trim()) } })));

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/migrantifly', {
    useNewUrlParser: true,
    useUnifiedTopology: true,
})
    .then(() => {
        logger.info('Connected to MongoDB');
    })
    .catch((error) => {
        logger.error('MongoDB connection error:', error);
        process.exit(1);
    });

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.status(200).json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// API routes
app.use('/api/auth',assertMiddleware('authRoutes', authRoutes));
app.use('/api/client', auth,assertMiddleware('clientRoutes', clientRoutes));
app.use('/api/admin', auth,assertMiddleware('adminRoutes', adminRoutes));
app.use('/api/consultation', assertMiddleware('consultationRoutes',consultationRoutes));
app.use('/api/documents', auth,assertMiddleware('documentRoutes', documentRoutes));
app.use('/api/payments', auth, assertMiddleware('paymentRoutes',paymentRoutes));
app.use('/api/applications', auth, assertMiddleware('applicationRoutes',applicationRoutes));
app.use('/api/notifications', auth,assertMiddleware('notificationRoutes', notificationRoutes));

// Error handling middleware
app.use(assertMiddleware('errorHandler', errorHandler));

// Serve Swagger UI and raw OpenAPI JSON
app.use(
  '/api/docs',
  assertMiddleware('swaggerUi.serve', swaggerUi.serve),
  assertMiddleware('swaggerUi.setup', swaggerUi.setup(swaggerSpec))
);
app.get('/api/openapi.json', (req, res) => res.json(swaggerSpec));

/**
 * @openapi
 * /api/health:
 *   get:
 *     summary: Health check
 *     tags:
 *       - System
 *     responses:
 *       200:
 *         description: Server is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: OK
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                 uptime:
 *                   type: number
 */
app.get('/api/health', (req, res) => {
    res.status(200).json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
    });
});
// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({
        success: false,
        message: 'Route not found'
    });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
});

module.exports = app;
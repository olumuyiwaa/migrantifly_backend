# Migrantifly Backend - Complete Setup Guide

## Project Structure
```
migrantifly-backend/
├── server.js                    # Main server file
├── package.json                 # Dependencies and scripts
├── .env.example                 # Environment variables template
├── .gitignore                   # Git ignore rules
├── middleware/
│   ├── auth.js                  # Authentication middleware
│   ├── errorHandler.js          # Error handling middleware
│   ├── auditLog.js             # Audit logging middleware
│   └── validation.js           # Request validation middleware
├── models/
│   ├── User.js                 # User model
│   ├── Application.js          # Application model
│   ├── Document.js             # Document model
│   ├── Payment.js              # Payment model
│   ├── Agreement.js            # Agreement model
│   ├── Notification.js         # Notification model
│   ├── Consultation.js         # Consultation model
│   └── AuditLog.js            # Audit log model
├── routes/
│   ├── auth.js                 # Authentication routes
│   ├── application.js          # Application management routes
│   ├── document.js             # Document management routes
│   ├── payment.js              # Payment processing routes
│   ├── notification.js         # Notification routes
│   ├── consultation.js         # Consultation booking routes
│   ├── admin.js               # Admin panel routes
│   └── client.js              # Client portal routes
├── utils/
│   ├── email.js               # Email sending utilities
│   ├── fileStorage.js         # Cloud storage utilities
│   ├── fileValidation.js      # File validation utilities
│   ├── invoiceGenerator.js    # PDF invoice generation
│   ├── logger.js              # Winston logger setup
│   ├── notifications.js       # Notification utilities
│   ├── progressCalculator.js  # Progress calculation
│   └── tokenGenerator.js      # Token generation utilities
├── constants/
│   └── applicationConstants.js # Application constants
├── templates/
│   ├── account-setup.hbs      # Account setup email template
│   ├── consultation-confirmation.hbs # Consultation confirmation
│   ├── payment-confirmation.hbs # Payment confirmation
│   ├── notification.hbs       # General notification template
│   └── adviser-welcome.hbs    # Adviser welcome email
├── scripts/
│   ├── cronJobs.js            # Scheduled tasks
│   └── seedDatabase.js        # Database seeding
├── uploads/
│   └── temp/                  # Temporary file uploads
├── logs/                      # Application logs
└── README.md                  # Project documentation
```

## Installation & Setup

### 1. Clone and Install Dependencies
```bash
# Clone the repository
git clone <your-repo-url>
cd migrantifly-backend

# Install dependencies
npm install

# Create directories
mkdir uploads/temp logs invoices
```

### 2. Environment Configuration
Create a `.env` file based on `.env.example`:

```bash
cp .env.example .env
```

Update the following environment variables:

```env
# Application
NODE_ENV=development
PORT=5000

# Database
MONGODB_URI=mongodb://localhost:27017/migrantifly

# Security
JWT_SECRET=your-super-secret-jwt-key-minimum-32-characters
JWT_EXPIRE=7d

# Frontend
FRONTEND_URL=http://localhost:3000

# Email (Gmail example)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-specific-password
FROM_EMAIL=noreply@migrantifly.com

# AWS S3 (for file storage)
AWS_ACCESS_KEY_ID=your-aws-access-key
AWS_SECRET_ACCESS_KEY=your-aws-secret-key
AWS_REGION=ap-southeast-2
AWS_S3_BUCKET=migrantifly-documents

# Stripe (for payments)
STRIPE_PUBLISHABLE_KEY=pk_test_your_publishable_key
STRIPE_SECRET_KEY=sk_test_your_secret_key
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret

# Logging
LOG_LEVEL=info
```

### 3. Database Setup
Make sure MongoDB is running locally or use MongoDB Atlas:

```bash
# Start MongoDB locally
mongod --dbpath /path/to/your/db

# Or use MongoDB Atlas connection string
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/migrantifly
```

### 4. Email Templates
Create the `templates` directory and add Handlebars email templates:
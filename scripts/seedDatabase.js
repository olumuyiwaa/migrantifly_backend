// scripts/seedDatabase.js
const path = require('path');
const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const seedDatabase = async () => {
    try {
        // Connect to MongoDB
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/migrantifly');
        console.log('Connected to MongoDB');

        // Register model definitions (ensures they are attached to mongoose.models)
        require('../models/User');
        require('../models/Application');
        require('../models/Document');
        require('../models/Payment');
        require('../models/Consultation');
        require('../models/Agreement');
        require('../models/Notification');

        // Retrieve compiled models from mongoose
        const User = mongoose.models.User;
        const Application = mongoose.models.Application;
        const Document = mongoose.models.Document;
        const Payment = mongoose.models.Payment;
        const Consultation = mongoose.models.Consultation;
        const Agreement = mongoose.models.Agreement;
        const Notification = mongoose.models.Notification;

        // Optional: quick visibility if any model was not registered
        // console.log('Loaded models:', Object.keys(mongoose.models));

        // Clear existing data (drop the DB avoids per-model deleteMany issues)
        await mongoose.connection.dropDatabase();
        console.log('Cleared existing data');

        // Create admin user
        const adminUser = new User({
            email: 'admin@migrantifly.com',
            password: 'admin123',
            role: 'admin',
            profile: { firstName: 'Admin', lastName: 'User', phone: '+64-21-123-4567' },
            isEmailVerified: true,
            isActive: true
        });
        await adminUser.save();
        console.log('Created admin user');

        // Create adviser user
        const adviserUser = new User({
            email: 'adviser@migrantifly.com',
            password: 'adviser123',
            role: 'adviser',
            profile: { firstName: 'Jane', lastName: 'Smith', phone: '+64-21-765-4321' },
            isEmailVerified: true,
            isActive: true
        });
        await adviserUser.save();
        console.log('Created adviser user');

        // Create sample clients
        const clientsData = [
            {
                email: 'john.doe@example.com',
                password: 'password123',
                role: 'client',
                profile: {
                    firstName: 'John',
                    lastName: 'Doe',
                    phone: '+64-21-111-2222',
                    dateOfBirth: new Date('1985-06-15'),
                    nationality: 'British',
                    address: {
                        street: '123 Queen Street',
                        city: 'Auckland',
                        state: 'Auckland',
                        country: 'New Zealand',
                        postalCode: '1010'
                    }
                },
                isEmailVerified: true,
                isActive: true
            },
            {
                email: 'jane.wilson@example.com',
                password: 'password123',
                role: 'client',
                profile: {
                    firstName: 'Jane',
                    lastName: 'Wilson',
                    phone: '+64-21-333-4444',
                    dateOfBirth: new Date('1990-03-20'),
                    nationality: 'Canadian',
                    address: {
                        street: '456 Collins Street',
                        city: 'Wellington',
                        state: 'Wellington',
                        country: 'New Zealand',
                        postalCode: '6011'
                    }
                },
                isEmailVerified: true,
                isActive: true
            }
        ];
        await User.insertMany(clientsData);
        console.log('Created sample client users');


        // Consultations
        const consultationsData = [
              {
                  clientId: createdClients[0]._id,
                  adviserId: adviserUser._id,
                  type: 'initial',
                  scheduledDate: new Date('2025-01-15T10:00:00Z'),
                  duration: 60,
                  method: 'zoom',
                  status: 'completed',
                  notes: 'Client interested in work visa. Has job offer from NZ company.',
                  visaPathways: ['Essential Skills Work Visa', 'Skilled Migrant Category'],
                  clientToken: 'MF-12345-ABC123'
              },
              {
                  clientId: createdClients[1]._id,
                  adviserId: adviserUser._id,
                  type: 'initial',
                  scheduledDate: new Date('2025-01-20T14:00:00Z'),
                  duration: 60,
                  method: 'phone',
                  status: 'scheduled',
                  notes: 'Client inquiry about partner visa options.'
              }
          ]
        ;
        await Consultation.insertMany(consultationsData);
        console.log('Created sample consultations');

        // Applications
        const applicationsData = [
              {
                  clientId: createdClients[0]._id,
                  adviserId: adviserUser._id,
                  consultationId: createdConsultations[0]._id,
                  visaType: 'work',
                  stage: 'documents_completed',
                  progress: 40,
                  timeline: [
                      { stage: 'consultation', date: new Date('2025-01-15'), notes: 'Initial consultation completed', updatedBy: adviserUser._id },
                      { stage: 'deposit_paid', date: new Date('2025-01-16'), notes: 'Deposit payment received', updatedBy: adviserUser._id },
                      { stage: 'documents_completed', date: new Date('2025-01-20'), notes: 'All required documents uploaded and approved', updatedBy: adviserUser._id }
                  ]
              },
              {
                  clientId: createdClients[1]._id,
                  adviserId: adviserUser._id,
                  consultationId: createdConsultations[1]._id,
                  visaType: 'partner',
                  stage: 'deposit_paid',
                  progress: 20,
                  timeline: [
                      { stage: 'consultation', date: new Date('2025-01-20'), notes: 'Initial consultation completed', updatedBy: adviserUser._id },
                      { stage: 'deposit_paid', date: new Date('2025-01-21'), notes: 'Deposit payment received', updatedBy: adviserUser._id }
                  ]
              }
          ];
        await Application.insertMany(applicationsData);
        console.log('Created sample applications');

        // Documents
        const documentsData = [
              {
                  applicationId: createdApplications[0]._id,
                  clientId: createdClients[0]._id,
                  type: 'passport',
                  name: 'passport-copy.pdf',
                  originalName: 'john_passport.pdf',
                  fileUrl: 'https://example.com/documents/passport-copy.pdf',
                  fileSize: 2048000,
                  mimeType: 'application/pdf',
                  status: 'approved',
                  reviewNotes: 'Clear and valid passport copy',
                  reviewedBy: adviserUser._id,
                  reviewedAt: new Date('2025-01-18'),
                  isRequired: true
              },
              {
                  applicationId: createdApplications[0]._id,
                  clientId: createdClients[0]._id,
                  type: 'job_offer',
                  name: 'job-offer-letter.pdf',
                  originalName: 'abc_company_offer.pdf',
                  fileUrl: 'https://example.com/documents/job-offer-letter.pdf',
                  fileSize: 1024000,
                  mimeType: 'application/pdf',
                  status: 'approved',
                  reviewNotes: 'Valid job offer from accredited employer',
                  reviewedBy: adviserUser._id,
                  reviewedAt: new Date('2025-01-19'),
                  isRequired: true
              }
          ]
        ;
        await Document.insertMany(documentsData);
        console.log('Created sample documents');

        // Payments
        const paymentsData = [
              {
                  clientId: createdClients[0]._id,
                  applicationId: createdApplications[0]._id,
                  amount: 500,
                  currency: 'NZD',
                  type: 'deposit',
                  status: 'completed',
                  paymentMethod: 'credit_card',
                  transactionId: 'pi_1234567890',
                  gatewayReference: 'stripe_ref_123',
                  invoiceNumber: 'INV-2025-001',
                  invoiceUrl: 'https://example.com/invoices/INV-2025-001.pdf'
              },
              {
                  clientId: createdClients[1]._id,
                  applicationId: createdApplications[1]._id,
                  amount: 600,
                  currency: 'NZD',
                  type: 'deposit',
                  status: 'completed',
                  paymentMethod: 'credit_card',
                  transactionId: 'pi_0987654321',
                  gatewayReference: 'stripe_ref_456',
                  invoiceNumber: 'INV-2025-002',
                  invoiceUrl: 'https://example.com/invoices/INV-2025-002.pdf'
              }
          ]
        ;
        await Payment.insertMany(paymentsData);
        console.log('Created sample payments');

        // Notifications
        const notificationsData = [
              {
                  userId: createdClients[0]._id,
                  applicationId: createdApplications[0]._id,
                  type: 'document_approved',
                  title: 'Document Approved',
                  message: 'Your passport document has been approved',
                  priority: 'medium',
                  isRead: false,
                  actionRequired: false
              },
              {
                  userId: createdClients[1]._id,
                  applicationId: createdApplications[1]._id,
                  type: 'stage_updated',
                  title: 'Application Stage Updated',
                  message: 'Your application has been moved to DEPOSIT PAID',
                  priority: 'medium',
                  isRead: false,
                  actionRequired: false
              }
          ]
        ;
        await Notification.insertMany(notificationsData);
        console.log('Created sample notifications');

        console.log('\n=== SEED DATA SUMMARY ===');
        console.log('Database seeding completed successfully!');
    } catch (error) {
        console.error('Error seeding database:', error);
    } finally {
        await mongoose.disconnect();
        console.log('Disconnected from MongoDB');
        process.exit(0);
    }
};

seedDatabase();
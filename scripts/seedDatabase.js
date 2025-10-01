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

        // Clear existing data
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

        // Create sample client users
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
                },
                {
                    email: 'alice.smith@example.com',
                    password: 'password123',
                    role: 'client',
                    profile: {
                        firstName: 'Alice',
                        lastName: 'Smith',
                        phone: '+64-21-555-1111',
                        dateOfBirth: new Date('1992-07-10'),
                        nationality: 'Australian',
                        address: {
                            street: '789 King Street',
                            city: 'Christchurch',
                            state: 'Canterbury',
                            country: 'New Zealand',
                            postalCode: '8011'
                        }
                    },
                    isEmailVerified: true,
                    isActive: true
                },
            ];

            const createdClients = [];
            for (const client of clientsData) {
                const user = new User(client);
                await user.save(); // triggers pre-save hook for hashing
                createdClients.push(user);
            }
            console.log('Created sample client users');

        // Create sample consultations
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
        ];
        const createdConsultations = await Consultation.insertMany(consultationsData);
        console.log('Created sample consultations');

        // Create sample applications
        const applicationsData = [
            {
                clientId: createdClients[0]._id,
                adviserId: adviserUser._id,
                consultationId: createdConsultations[0]._id,

                // Destination country
                destinationCountry: {
                    code: 'NZ',
                    name: 'New Zealand'
                },

                // Basic application info
                visaType: 'work',
                stage: 'submitted_to_inz',
                progress: 70,

                // INZ/Immigration details
                inzReference: 'NZ-2025-WV-12456789',
                submissionDate: new Date('2025-01-25'),

                // Deadlines
                deadlines: [
                    {
                        type: 'document',
                        description: 'Submit updated police clearance certificate',
                        dueDate: new Date('2025-02-15'),
                        completed: true
                    },
                    {
                        type: 'medical',
                        description: 'Complete medical examination at approved panel physician',
                        dueDate: new Date('2025-02-28'),
                        completed: false
                    },
                    {
                        type: 'rfi',
                        description: 'Provide additional employment contract details',
                        dueDate: new Date('2025-03-10'),
                        completed: false
                    }
                ],

                // Comprehensive timeline
                timeline: [
                    {
                        stage: 'consultation',
                        date: new Date('2025-01-10'),
                        notes: 'Initial consultation completed. Discussed Essential Skills Work Visa requirements. Client meets all basic criteria.',
                        updatedBy: adviserUser._id
                    },
                    {
                        stage: 'deposit_paid',
                        date: new Date('2025-01-12'),
                        notes: 'Deposit payment of $500 received via bank transfer. Receipt #DEP-001 issued.',
                        updatedBy: adviserUser._id
                    },
                    {
                        stage: 'documents_completed',
                        date: new Date('2025-01-22'),
                        notes: 'All required documents uploaded and approved: passport, job offer letter, employment contract, qualifications (Bachelor of Computer Science), police clearance, passport photos. Document checklist 100% complete.',
                        updatedBy: adviserUser._id
                    },
                    {
                        stage: 'additional_docs_required',
                        date: new Date('2025-01-23'),
                        notes: 'Requested updated police clearance certificate as current one expires before expected visa grant date.',
                        updatedBy: adviserUser._id
                    },
                    {
                        stage: 'documents_completed',
                        date: new Date('2025-01-24'),
                        notes: 'Updated police clearance certificate received and approved. Valid until December 2025.',
                        updatedBy: adviserUser._id
                    },
                    {
                        stage: 'submitted_to_inz',
                        date: new Date('2025-01-25'),
                        notes: 'Application successfully submitted to Immigration New Zealand via online portal. INZ Reference: NZ-2025-WV-12456789. Estimated processing time: 4-8 weeks.',
                        updatedBy: adviserUser._id
                    },
                    {
                        stage: 'inz_processing',
                        date: new Date('2025-01-26'),
                        notes: 'INZ confirmed receipt of application. Application is in queue for case officer assignment.',
                        updatedBy: adviserUser._id
                    },
                    {
                        stage: 'inz_processing',
                        date: new Date('2025-02-05'),
                        notes: 'Case officer assigned. Medical examination requested - deadline February 28, 2025.',
                        updatedBy: adviserUser._id
                    },
                    {
                        stage: 'rfi_received',
                        date: new Date('2025-02-18'),
                        notes: 'Request for Information (RFI) received from INZ. Additional details required about employment contract terms and job duties. Client notified immediately. Response deadline: March 10, 2025.',
                        updatedBy: adviserUser._id
                    }
                ],

                // Metadata
                createdAt: new Date('2025-01-10'),
                updatedAt: new Date('2025-02-18')
            },
            {
                clientId: createdClients[1]._id,
                adviserId: adviserUser._id,
                consultationId: createdConsultations[1]._id,
                visaType: 'partner',
                stage: 'deposit_paid',
                progress: 20,
                inzReference: 'INZ-REF-00123',
                submissionDate: new Date('2024-12-01'),
                decisionDate: new Date('2025-02-15'),
                outcome: 'approved',
                decisionLetter: '/uploads/letters/decision-00999.pdf',
                deadlines: [
                    {
                        type: 'medical',
                        description: 'Medical examination submission',
                        dueDate: new Date('2025-02-15'),
                        completed: false
                    },
                    {
                        type: 'document',
                        description: 'Upload police certificate',
                        dueDate: new Date('2025-02-20'),
                        completed: false
                    }
                ],
                timeline: [
                    {
                        stage: 'consultation',
                        date: new Date('2025-01-20'),
                        notes: 'Initial consultation completed',
                        updatedBy: adviserUser._id
                    },
                    {
                        stage: 'deposit_paid',
                        date: new Date('2025-01-21'),
                        notes: 'Deposit payment received',
                        updatedBy: adviserUser._id
                    }
                ]
            }
        ];
        const createdApplications = await Application.insertMany(applicationsData);
        console.log('Created sample applications');

        // Create sample documents
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
        ];
        await Document.insertMany(documentsData);
        console.log('Created sample documents');

        // Create sample payments
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
        ];
        await Payment.insertMany(paymentsData);
        console.log('Created sample payments');

        // Create sample notifications
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
        ];
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

// npm run seed && node server.js
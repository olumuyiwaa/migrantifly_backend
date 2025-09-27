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
                {
                    email: 'bob.jones@example.com',
                    password: 'password123',
                    role: 'client',
                    profile: {
                        firstName: 'Bob',
                        lastName: 'Jones',
                        phone: '+64-21-555-2222',
                        dateOfBirth: new Date('1988-11-05'),
                        nationality: 'Irish',
                        address: {
                            street: '321 Victoria Street',
                            city: 'Hamilton',
                            state: 'Waikato',
                            country: 'New Zealand',
                            postalCode: '3204'
                        }
                    },
                    isEmailVerified: true,
                    isActive: true
                },
                {
                    email: 'carol.brown@example.com',
                    password: 'password123',
                    role: 'client',
                    profile: {
                        firstName: 'Carol',
                        lastName: 'Brown',
                        phone: '+64-21-555-3333',
                        dateOfBirth: new Date('1995-02-18'),
                        nationality: 'South African',
                        address: {
                            street: '654 Main Road',
                            city: 'Dunedin',
                            state: 'Otago',
                            country: 'New Zealand',
                            postalCode: '9016'
                        }
                    },
                    isEmailVerified: true,
                    isActive: true
                },
                {
                    email: 'david.lee@example.com',
                    password: 'password123',
                    role: 'client',
                    profile: {
                        firstName: 'David',
                        lastName: 'Lee',
                        phone: '+64-21-555-4444',
                        dateOfBirth: new Date('1983-09-12'),
                        nationality: 'Chinese',
                        address: {
                            street: '987 George Street',
                            city: 'Palmerston North',
                            state: 'Manawatu',
                            country: 'New Zealand',
                            postalCode: '4410'
                        }
                    },
                    isEmailVerified: true,
                    isActive: true
                },
                {
                    email: 'emma.taylor@example.com',
                    password: 'password123',
                    role: 'client',
                    profile: {
                        firstName: 'Emma',
                        lastName: 'Taylor',
                        phone: '+64-21-555-5555',
                        dateOfBirth: new Date('1997-12-25'),
                        nationality: 'American',
                        address: {
                            street: '246 Broadway',
                            city: 'Napier',
                            state: 'Hawke\'s Bay',
                            country: 'New Zealand',
                            postalCode: '4110'
                        }
                    },
                    isEmailVerified: true,
                    isActive: true
                },
                {
                    email: 'frank.martin@example.com',
                    password: 'password123',
                    role: 'client',
                    profile: {
                        firstName: 'Frank',
                        lastName: 'Martin',
                        phone: '+64-21-555-6666',
                        dateOfBirth: new Date('1980-04-30'),
                        nationality: 'German',
                        address: {
                            street: '135 Albert Street',
                            city: 'Tauranga',
                            state: 'Bay of Plenty',
                            country: 'New Zealand',
                            postalCode: '3110'
                        }
                    },
                    isEmailVerified: true,
                    isActive: true
                },
                {
                    email: 'grace.evans@example.com',
                    password: 'password123',
                    role: 'client',
                    profile: {
                        firstName: 'Grace',
                        lastName: 'Evans',
                        phone: '+64-21-555-7777',
                        dateOfBirth: new Date('1991-08-14'),
                        nationality: 'French',
                        address: {
                            street: '753 K Road',
                            city: 'Rotorua',
                            state: 'Bay of Plenty',
                            country: 'New Zealand',
                            postalCode: '3010'
                        }
                    },
                    isEmailVerified: true,
                    isActive: true
                },
                {
                    email: 'henry.clark@example.com',
                    password: 'password123',
                    role: 'client',
                    profile: {
                        firstName: 'Henry',
                        lastName: 'Clark',
                        phone: '+64-21-555-8888',
                        dateOfBirth: new Date('1986-03-22'),
                        nationality: 'Indian',
                        address: {
                            street: '852 Dominion Road',
                            city: 'New Plymouth',
                            state: 'Taranaki',
                            country: 'New Zealand',
                            postalCode: '4310'
                        }
                    },
                    isEmailVerified: true,
                    isActive: true
                },
                {
                    email: 'isabel.hall@example.com',
                    password: 'password123',
                    role: 'client',
                    profile: {
                        firstName: 'Isabel',
                        lastName: 'Hall',
                        phone: '+64-21-555-9999',
                        dateOfBirth: new Date('1993-05-17'),
                        nationality: 'Filipino',
                        address: {
                            street: '369 Symonds Street',
                            city: 'Whangarei',
                            state: 'Northland',
                            country: 'New Zealand',
                            postalCode: '0110'
                        }
                    },
                    isEmailVerified: true,
                    isActive: true
                },
                {
                    email: 'jack.king@example.com',
                    password: 'password123',
                    role: 'client',
                    profile: {
                        firstName: 'Jack',
                        lastName: 'King',
                        phone: '+64-21-555-0000',
                        dateOfBirth: new Date('1989-10-09'),
                        nationality: 'Malaysian',
                        address: {
                            street: '147 Queen Street',
                            city: 'Invercargill',
                            state: 'Southland',
                            country: 'New Zealand',
                            postalCode: '9810'
                        }
                    },
                    isEmailVerified: true,
                    isActive: true
                },
                {
                    email: 'karen.moore@example.com',
                    password: 'password123',
                    role: 'client',
                    profile: {
                        firstName: 'Karen',
                        lastName: 'Moore',
                        phone: '+64-21-555-1010',
                        dateOfBirth: new Date('1996-06-28'),
                        nationality: 'Singaporean',
                        address: {
                            street: '258 Cuba Street',
                            city: 'Lower Hutt',
                            state: 'Wellington',
                            country: 'New Zealand',
                            postalCode: '5010'
                        }
                    },
                    isEmailVerified: true,
                    isActive: true
                },
                {
                    email: 'liam.scott@example.com',
                    password: 'password123',
                    role: 'client',
                    profile: {
                        firstName: 'Liam',
                        lastName: 'Scott',
                        phone: '+64-21-555-2020',
                        dateOfBirth: new Date('1987-01-19'),
                        nationality: 'Japanese',
                        address: {
                            street: '369 Lambton Quay',
                            city: 'Porirua',
                            state: 'Wellington',
                            country: 'New Zealand',
                            postalCode: '5022'
                        }
                    },
                    isEmailVerified: true,
                    isActive: true
                },
                {
                    email: 'mia.green@example.com',
                    password: 'password123',
                    role: 'client',
                    profile: {
                        firstName: 'Mia',
                        lastName: 'Green',
                        phone: '+64-21-555-3030',
                        dateOfBirth: new Date('1994-09-03'),
                        nationality: 'Brazilian',
                        address: {
                            street: '741 Willis Street',
                            city: 'Nelson',
                            state: 'Nelson',
                            country: 'New Zealand',
                            postalCode: '7010'
                        }
                    },
                    isEmailVerified: true,
                    isActive: true
                },
                {
                    email: 'noah.harris@example.com',
                    password: 'password123',
                    role: 'client',
                    profile: {
                        firstName: 'Noah',
                        lastName: 'Harris',
                        phone: '+64-21-555-4040',
                        dateOfBirth: new Date('1982-02-11'),
                        nationality: 'Spanish',
                        address: {
                            street: '852 Featherston Street',
                            city: 'Gisborne',
                            state: 'Gisborne',
                            country: 'New Zealand',
                            postalCode: '4010'
                        }
                    },
                    isEmailVerified: true,
                    isActive: true
                },
                {
                    email: 'olivia.lewis@example.com',
                    password: 'password123',
                    role: 'client',
                    profile: {
                        firstName: 'Olivia',
                        lastName: 'Lewis',
                        phone: '+64-21-555-5050',
                        dateOfBirth: new Date('1998-11-27'),
                        nationality: 'Dutch',
                        address: {
                            street: '963 The Terrace',
                            city: 'Timaru',
                            state: 'Canterbury',
                            country: 'New Zealand',
                            postalCode: '7910'
                        }
                    },
                    isEmailVerified: true,
                    isActive: true
                },
                {
                    email: 'paul.walker@example.com',
                    password: 'password123',
                    role: 'client',
                    profile: {
                        firstName: 'Paul',
                        lastName: 'Walker',
                        phone: '+64-21-555-6060',
                        dateOfBirth: new Date('1984-04-15'),
                        nationality: 'Swedish',
                        address: {
                            street: '147 Riccarton Road',
                            city: 'Blenheim',
                            state: 'Marlborough',
                            country: 'New Zealand',
                            postalCode: '7201'
                        }
                    },
                    isEmailVerified: true,
                    isActive: true
                },
                {
                    email: 'quinn.young@example.com',
                    password: 'password123',
                    role: 'client',
                    profile: {
                        firstName: 'Quinn',
                        lastName: 'Young',
                        phone: '+64-21-555-7070',
                        dateOfBirth: new Date('1991-07-21'),
                        nationality: 'Korean',
                        address: {
                            street: '258 Fenton Street',
                            city: 'Whanganui',
                            state: 'Manawatu',
                            country: 'New Zealand',
                            postalCode: '4500'
                        }
                    },
                    isEmailVerified: true,
                    isActive: true
                },
                {
                    email: 'ruby.zhao@example.com',
                    password: 'password123',
                    role: 'client',
                    profile: {
                        firstName: 'Ruby',
                        lastName: 'Zhao',
                        phone: '+64-21-555-8080',
                        dateOfBirth: new Date('1993-03-13'),
                        nationality: 'Chinese',
                        address: {
                            street: '369 Main Street',
                            city: 'Taupo',
                            state: 'Waikato',
                            country: 'New Zealand',
                            postalCode: '3330'
                        }
                    },
                    isEmailVerified: true,
                    isActive: true
                },
                {
                    email: 'samuel.baker@example.com',
                    password: 'password123',
                    role: 'client',
                    profile: {
                        firstName: 'Samuel',
                        lastName: 'Baker',
                        phone: '+64-21-555-9090',
                        dateOfBirth: new Date('1985-12-08'),
                        nationality: 'Italian',
                        address: {
                            street: '741 Victoria Avenue',
                            city: 'Masterton',
                            state: 'Wellington',
                            country: 'New Zealand',
                            postalCode: '5810'
                        }
                    },
                    isEmailVerified: true,
                    isActive: true
                },
                {
                    email: 'tina.carter@example.com',
                    password: 'password123',
                    role: 'client',
                    profile: {
                        firstName: 'Tina',
                        lastName: 'Carter',
                        phone: '+64-21-555-1112',
                        dateOfBirth: new Date('1990-01-30'),
                        nationality: 'Russian',
                        address: {
                            street: '963 Cuba Street',
                            city: 'Queenstown',
                            state: 'Otago',
                            country: 'New Zealand',
                            postalCode: '9300'
                        }
                    },
                    isEmailVerified: true,
                    isActive: true
                },
                {
                    email: 'uma.davis@example.com',
                    password: 'password123',
                    role: 'client',
                    profile: {
                        firstName: 'Uma',
                        lastName: 'Davis',
                        phone: '+64-21-555-1212',
                        dateOfBirth: new Date('1992-05-05'),
                        nationality: 'Indian',
                        address: {
                            street: '258 Main Road',
                            city: 'Oamaru',
                            state: 'Otago',
                            country: 'New Zealand',
                            postalCode: '9400'
                        }
                    },
                    isEmailVerified: true,
                    isActive: true
                },
                {
                    email: 'victor.edwards@example.com',
                    password: 'password123',
                    role: 'client',
                    profile: {
                        firstName: 'Victor',
                        lastName: 'Edwards',
                        phone: '+64-21-555-1313',
                        dateOfBirth: new Date('1981-08-16'),
                        nationality: 'British',
                        address: {
                            street: '147 Main Street',
                            city: 'Greymouth',
                            state: 'West Coast',
                            country: 'New Zealand',
                            postalCode: '7805'
                        }
                    },
                    isEmailVerified: true,
                    isActive: true
                },
                {
                    email: 'wendy.franklin@example.com',
                    password: 'password123',
                    role: 'client',
                    profile: {
                        firstName: 'Wendy',
                        lastName: 'Franklin',
                        phone: '+64-21-555-1414',
                        dateOfBirth: new Date('1999-04-11'),
                        nationality: 'Canadian',
                        address: {
                            street: '369 Queen Street',
                            city: 'Westport',
                            state: 'West Coast',
                            country: 'New Zealand',
                            postalCode: '7825'
                        }
                    },
                    isEmailVerified: true,
                    isActive: true
                }
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
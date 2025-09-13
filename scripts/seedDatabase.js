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

        // --- your existing seeding logic below stays the same ---
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
        const consultationsData = [ /* ... unchanged ... */ ];
        const createdConsultations = await Consultation.insertMany(consultationsData);
        console.log('Created sample consultations');

        // Applications
        const applicationsData = [ /* ... unchanged ... */ ];
        const createdApplications = await Application.insertMany(applicationsData);
        console.log('Created sample applications');

        // Documents
        const documentsData = [ /* ... unchanged ... */ ];
        await Document.insertMany(documentsData);
        console.log('Created sample documents');

        // Payments
        const paymentsData = [ /* ... unchanged ... */ ];
        await Payment.insertMany(paymentsData);
        console.log('Created sample payments');

        // Notifications
        const notificationsData = [ /* ... unchanged ... */ ];
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
const mongoose = require('mongoose');

// Require each model file to register its schema with Mongoose
require('./User');
require('./Application');
require('./Document');
require('./Payment');
require('./Consultation');
require('./Agreement');
require('./Notification');

// Export compiled models from mongoose.models
module.exports = {
  User: mongoose.models.User,
  Application: mongoose.models.Application,
  Document: mongoose.models.Document,
  Payment: mongoose.models.Payment,
  Consultation: mongoose.models.Consultation,
  Agreement: mongoose.models.Agreement,
  Notification: mongoose.models.Notification
};

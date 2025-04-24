const mongoose = require("mongoose");

const applicationSchema = new mongoose.Schema({
  name: String,
  address: String,
  income: String,
  loanAmount: String,
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model("Application", applicationSchema);

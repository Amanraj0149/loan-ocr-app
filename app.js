const express = require("express");
const multer = require("multer"); // for handling file uploads
const path = require("path");
const fs = require("fs");
const sharp = require("sharp"); // for image preprocessing
const Tesseract = require("tesseract.js"); // for OCR (text extraction)
const mongoose = require("mongoose"); // to connect and save data to MongoDB
const { body, validationResult } = require("express-validator"); // to validate form data
require("dotenv").config(); // to load database connection string from .env

const Application = require("./models/Application");
const app = express();

// Parse form data from POST requests
app.use(express.urlencoded({ extended: true }));

// Set EJS as the template engine
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Configure file upload location and naming
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

// Connect to MongoDB (local or Atlas)
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => console.log("✅ Connected to MongoDB"))
  .catch(err => console.error("❌ MongoDB connection error:", err));

// Home page (upload form)
app.get("/", (req, res) => {
  res.render("index");
});

// Handle file upload and extract text from document
app.post("/upload", upload.single("loanDocument"), async (req, res) => {
  try {
    const originalPath = req.file.path;
    const processedPath = `processed/processed_${Date.now()}.png`;

    // Preprocess image: convert to grayscale and normalize contrast
    await sharp(originalPath).grayscale().normalize().toFile(processedPath);

    // Perform OCR using Tesseract on the cleaned image
    const result = await Tesseract.recognize(processedPath, "eng");

    // Delete the temp processed image
    fs.unlinkSync(processedPath);

    const text = result.data.text;
    const lines = text.split("\n").map(l => l.trim()).filter(Boolean);

    // Try to find values in text using keywords
    let name = "Not found", address = "Not found", income = "Not found", loanAmount = "Not found";
    lines.forEach(line => {
      if (/name\s*[:\-]/i.test(line)) name = line.split(/[:\-]/)[1]?.trim() || name;
      else if (/address\s*[:\-]/i.test(line)) address = line.split(/[:\-]/)[1]?.trim() || address;
      else if (/income\s*[:\-]/i.test(line)) income = line.split(/[:\-]/)[1]?.trim() || income;
      else if (/loan\s*amount\s*[:\-]/i.test(line)) loanAmount = line.split(/[:\-]/)[1]?.trim() || loanAmount;
    });

    // Show results to the user for manual review/edit
    res.render("result", {
      extractedData: { name, address, income, loanAmount, fullText: text }
    });
  } catch (err) {
    console.error("OCR Error:", err);
    res.status(500).send("Something went wrong.");
  }
});

// Handle final form submission with validation
app.post("/submit", [
  body("name")
    .isLength({ min: 2 }).withMessage("Name too short")
    .custom(value => value.toLowerCase() !== "not found").withMessage("Please enter a valid name."),
  body("address")
    .isLength({ min: 5 }).withMessage("Address too short")
    .custom(value => value.toLowerCase() !== "not found").withMessage("Please enter a valid address."),
  body("income")
    .matches(/^\d[\d,]*$/).withMessage("Invalid income format")
    .custom(value => value.toLowerCase() !== "not found").withMessage("Please enter a valid income."),
  body("loanAmount")
    .matches(/^\d[\d,]*$/).withMessage("Invalid loan amount format")
    .custom(value => value.toLowerCase() !== "not found").withMessage("Please enter a valid loan amount.")
], async (req, res) => {
  const errors = validationResult(req);
  const { name, address, income, loanAmount } = req.body;

  // If validation fails, reload result page with errors
  if (!errors.isEmpty()) {
    return res.status(400).render("result", {
      extractedData: { name, address, income, loanAmount, fullText: "Validation failed. Please correct the fields." },
      errors: errors.array()
    });
  }

  // Save to database
  try {
    const appData = new Application({ name, address, income, loanAmount });
    await appData.save();

    // Show confirmation page
    res.render("success", { name, address, income, loanAmount });
  } catch (err) {
    console.error("Mongo Save Error:", err);
    res.status(500).send("Error saving data.");
  }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));

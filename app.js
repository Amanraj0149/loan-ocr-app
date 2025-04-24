const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const sharp = require("sharp");
const Tesseract = require("tesseract.js");
const mongoose = require("mongoose");
const { body, validationResult } = require("express-validator");
require("dotenv").config();

const Application = require("./models/Application");
const app = express();

// 🔐 Ensure upload folders exist (for Render deployment)
const folders = ["uploads", "processed"];
folders.forEach(folder => {
  if (!fs.existsSync(folder)) {
    fs.mkdirSync(folder);
    console.log(`✅ Created folder: ${folder}`);
  }
});

app.use(express.urlencoded({ extended: true }));
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// File upload settings
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => console.log("✅ Connected to MongoDB"))
  .catch(err => console.error("❌ MongoDB connection error:", err));

// Home page
app.get("/", (req, res) => {
  res.render("index");
});

// Upload and process OCR
app.post("/upload", upload.single("loanDocument"), async (req, res) => {
  try {
    const originalPath = req.file.path;
    const processedPath = `processed/processed_${Date.now()}.png`;

    await sharp(originalPath).grayscale().normalize().toFile(processedPath);

    const result = await Tesseract.recognize(processedPath, "eng");
    fs.unlinkSync(processedPath);

    const text = result.data.text;
    const lines = text.split("\n").map(l => l.trim()).filter(Boolean);

    let name = "Not found", address = "Not found", income = "Not found", loanAmount = "Not found";
    lines.forEach(line => {
      if (/name\s*[:\-]/i.test(line)) name = line.split(/[:\-]/)[1]?.trim() || name;
      else if (/address\s*[:\-]/i.test(line)) address = line.split(/[:\-]/)[1]?.trim() || address;
      else if (/income\s*[:\-]/i.test(line)) income = line.split(/[:\-]/)[1]?.trim() || income;
      else if (/loan\s*amount\s*[:\-]/i.test(line)) loanAmount = line.split(/[:\-]/)[1]?.trim() || loanAmount;
    });

    res.render("result", {
      extractedData: { name, address, income, loanAmount, fullText: text }
    });
  } catch (err) {
    console.error("OCR Error:", err);
    res.status(500).send("Something went wrong.");
  }
});

// Submit route with validation
app.post("/submit", [
  body("name").isLength({ min: 2 }).withMessage("Name too short")
    .custom(value => value.toLowerCase() !== "not found").withMessage("Please enter a valid name."),
  body("address").isLength({ min: 5 }).withMessage("Address too short")
    .custom(value => value.toLowerCase() !== "not found").withMessage("Please enter a valid address."),
  body("income").matches(/^\d[\d,]*$/).withMessage("Invalid income format")
    .custom(value => value.toLowerCase() !== "not found").withMessage("Please enter a valid income."),
  body("loanAmount").matches(/^\d[\d,]*$/).withMessage("Invalid loan amount format")
    .custom(value => value.toLowerCase() !== "not found").withMessage("Please enter a valid loan amount.")
], async (req, res) => {
  const errors = validationResult(req);
  const { name, address, income, loanAmount } = req.body;

  if (!errors.isEmpty()) {
    return res.status(400).render("result", {
      extractedData: { name, address, income, loanAmount, fullText: "Validation failed. Please correct the fields." },
      errors: errors.array()
    });
  }

  try {
    const appData = new Application({ name, address, income, loanAmount });
    await appData.save();
    res.render("success", { name, address, income, loanAmount });
  } catch (err) {
    console.error("Mongo Save Error:", err);
    res.status(500).send("Error saving data.");
  }
});

// Start the app
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));

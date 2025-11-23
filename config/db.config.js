const mongoose = require("mongoose");
require("dotenv").config();

const dbUrl = process.env.DB_URL;
const dbName = process.env.DB_NAME;

// Validate environment variables
if (!dbUrl) {
  console.error("❌ DB_URL environment variable is not set!");
  console.error("Please set DB_URL in Render environment variables");
  process.exit(1);
}

if (!dbName) {
  console.error("❌ DB_NAME environment variable is not set!");
  console.error("Please set DB_NAME in Render environment variables");
  process.exit(1);
}

console.log("🔗 Attempting to connect to MongoDB...");
console.log(`Database Name: ${dbName}`);

mongoose
  .connect(dbUrl, {
    dbName: dbName,
  })
  .then(() => {
    console.log("✅ MongoDB connected successfully");
    console.log(`Connected to database: ${dbName}`);
  })
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err.message);
    console.error("Full error:", err);
    process.exit(1);
  });

// Handle connection events
mongoose.connection.on("connected", () => {
  console.log("Mongoose connected to MongoDB");
});

mongoose.connection.on("error", (err) => {
  console.error("Mongoose connection error:", err);
});

mongoose.connection.on("disconnected", () => {
  console.log("Mongoose disconnected from MongoDB");
});

// Graceful shutdown
process.on("SIGINT", async () => {
  await mongoose.connection.close();
  console.log("Mongoose connection closed through app termination");
  process.exit(0);
});

module.exports = mongoose;

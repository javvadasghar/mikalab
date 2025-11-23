const mongoose = require("mongoose");
require("dotenv").config();

const dbUrl = process.env.DB_URL;
const dbName = process.env.DB_NAME;

mongoose
  .connect(dbUrl, {
    dbName: dbName,
  })
  .then(() => {
    console.log("MongoDB connected successfully");
  })
  .catch((err) => {
    console.error("MongoDB connection error:", err);
  });

module.exports = mongoose;
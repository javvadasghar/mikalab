var createError = require("http-errors");
var express = require("express");
var app = express();
require("dotenv").config();
const db = require("./config/db.config");
var bodyParser = require("body-parser");
var userroutes1 = require("./routes/userRoutes");
var scenarioRoutes = require("./routes/ScenerioRoutes");
const port = process.env.PORT || 5000;
var cors = require("cors");
const fs = require("fs");
const path = require("path");

const tempDir = path.join(__dirname, "temp");
const videosDir = path.join(__dirname, "videos");
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
if (!fs.existsSync(videosDir)) fs.mkdirSync(videosDir, { recursive: true });

app.use(bodyParser.urlencoded({ extended: false }));

// Updated CORS configuration for production
const allowedOrigins = [
  "http://localhost:3000",
  process.env.FRONTEND_URL,
].filter(Boolean);

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);

      if (
        allowedOrigins.includes(origin) ||
        process.env.NODE_ENV !== "production"
      ) {
        return callback(null, true);
      }
      return callback(new Error("CORS policy violation"), false);
    },
    credentials: true,
  })
);

app.use(bodyParser.json());

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "OK",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    database: db.readyState === 1 ? "connected" : "disconnected",
  });
});

app.use("/api/user", userroutes1);
app.use("/api/scenario", scenarioRoutes);

// 404 handler
app.use(function (req, res, next) {
  next(createError(404));
});

// Error handler - FIXED
app.use(function (err, req, res, next) {
  // Set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get("env") === "development" ? err : {};

  // Send error response with proper status code
  const statusCode = err.status || 500;
  res.status(statusCode).json({
    error: {
      message: err.message,
      status: statusCode,
    },
  });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`Server running on port ${port}`);
  console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
  console.log(`DB_URL configured: ${process.env.DB_URL ? "Yes" : "No"}`);
});

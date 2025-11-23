var createError = require("http-errors");
var express = require("express");
var app = express();
require("dotenv").config();
const db = require("../backend/config/db.config");
var bodyParser = require("body-parser");
var userroutes1 = require("./routes/userRoutes");
var scenarioRoutes = require("./routes/ScenerioRoutes");
const port = 5000;
var cors = require("cors");
const fs = require('fs');
const path = require('path');
const tempDir = path.join(__dirname, 'temp');
const videosDir = path.join(__dirname, 'videos');
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
if (!fs.existsSync(videosDir)) fs.mkdirSync(videosDir, { recursive: true });

app.use(bodyParser.urlencoded({ extended: false }));

app.use(
  cors({
    origin: "*",
    credentials: false,
  })
);
app.use(bodyParser.json());
app.use("/api/user", userroutes1);
app.use("/api/scenario", scenarioRoutes);
app.use(function (req, res, next) {
  next(createError(404));
});
// error handler
app.use(function (err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get("env") === "development" ? err : {};
  // render the error page
  res.status(err.status || 500);
  res.status("error");
});
app.listen(port, () => {
  console.log(`Example app listening at http://localhost:${port}`);
});
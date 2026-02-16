const mongoose = require("mongoose");

const stopSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  travelTimeToNextStop: {
    type: Number,
    required: true,
    min: 0,
    default: 0,
  },
  stayTimeAtStop: {
    type: Number,
    required: true,
    min: 0,
    default: 0,
  },
});

const emergencySchema = new mongoose.Schema({
  text: {
    type: String,
    default: "",
  },
  startSecond: {
    type: Number,
    default: 0,
    min: 0,
  },
  seconds: {
    type: Number,
    default: 0,
    min: 0,
  },
  type: {
    type: String,
    enum: ["danger", "traffic", "information", "weather", "announcement"],
    default: "danger",
  },
});

const scenarioSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    stops: [stopSchema],
    emergencies: [emergencySchema],
    videoPath: {
      type: String,
    },
    videoStatus: {
      type: String,
      enum: ["pending", "generating", "completed", "failed"],
      default: "pending",
    },
    theme: {
      type: String,
      enum: ["dark", "light"],
      default: "dark",
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    createdByName: {
      type: String,
      required: true,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    updatedByName: {
      type: String,
    },
    lastUpdatedAt: {
      type: Date,
    },
    status: {
      type: Number,
      default: 1,
      enum: [0, 1],
    },
    deletedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Scenario", scenarioSchema);

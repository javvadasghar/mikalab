const mongoose = require("mongoose");

const stopSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  staySeconds: {
    type: Number,
    required: true,
    min: 0,
    default: 60,
  },
  betweenSeconds: {
    type: Number,
    required: true,
    min: 0,
    default: 0,
  },
  emergencyEnabled: {
    type: Boolean,
    default: false,
  },
  emergencySeconds: {
    type: Number,
    default: 0,
    min: 0,
  },
  emergencies: [
    {
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
    },
  ],
});

const scenarioSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    stops: [stopSchema],
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
  },
  { timestamps: true }
);

module.exports = mongoose.model("Scenario", scenarioSchema);

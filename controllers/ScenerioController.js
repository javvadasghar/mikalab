const scenarioModel = require("../models/scenerioModel");
const videoGenerator = require("../services/videoGenerator");
const path = require("path");
const fs = require("fs");

let isProcessingQueue = false;

const calculateScenarioDuration = (stops) => {
  return stops.reduce((total, stop) => {
    const stay = Number(stop.staySeconds) || 0;
    const between = Number(stop.betweenSeconds) || 0;
    const primaryEmergency = stop.emergencyEnabled
      ? Number(stop.emergencySeconds) || 0
      : 0;
    const emergenciesSum = Array.isArray(stop.emergencies)
      ? stop.emergencies.reduce((sum, e) => sum + (Number(e.seconds) || 0), 0)
      : 0;
    return total + stay + between + primaryEmergency + emergenciesSum;
  }, 0);
};

const videoExists = (scenarioId) => {
  const videosDir = path.join(__dirname, "../videos");
  const videoPath = path.join(videosDir, `scenario_${scenarioId}.mp4`);

  if (fs.existsSync(videoPath)) {
    const stats = fs.statSync(videoPath);
    return stats.size > 0;
  }
  return false;
};

const processVideoQueue = async () => {
  if (isProcessingQueue || videoQueue.length === 0) {
    return;
  }

  isProcessingQueue = true;

  videoQueue.sort((a, b) => a.duration - b.duration);

  while (videoQueue.length > 0) {
    const task = videoQueue.shift();

    try {
      console.log(
        `Starting video generation for scenario ${task.scenarioId} (Duration: ${
          task.duration
        }s, Queue position: ${videoQueue.length + 1})`
      );

      await videoGenerator.generateVideo(task.scenario, task.videoPath);

      await scenarioModel.findByIdAndUpdate(task.scenarioId, {
        videoPath: task.videoFileName,
        videoStatus: "completed",
      });

      console.log(
        `Video generated successfully for scenario ${task.scenarioId}`
      );
    } catch (err) {
      console.error(
        `Video generation error for scenario ${task.scenarioId}:`,
        err
      );

      await scenarioModel.findByIdAndUpdate(task.scenarioId, {
        videoStatus: "failed",
      });
    }
  }

  isProcessingQueue = false;
  console.log("Video generation queue completed");
};

const createScenario = async (req, res) => {
  try {
    const { name, stops } = req.body;
    const user = req.user;

    if (!name || !stops || !Array.isArray(stops) || stops.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Scenario name and at least one stop are required",
      });
    }

    const processedStops = stops.map((stop, index) => {
      const staySeconds = Number(stop.staySeconds) || 0;
      const betweenSeconds = Number(stop.betweenSeconds) || 0;
      const durationSeconds = Number(stop.durationSeconds) || staySeconds;

      return {
        name: stop.name || `Stop ${index + 1}`,
        staySeconds: staySeconds,
        betweenSeconds: betweenSeconds,
        durationSeconds: durationSeconds,
        emergencyEnabled:
          !!(stop.emergencies && stop.emergencies.length > 0) ||
          !!stop.emergencyEnabled,
        emergencySeconds: Number(stop.emergencySeconds) || 0,
        emergencies: Array.isArray(stop.emergencies)
          ? stop.emergencies.map((e) => ({
              text: e.text || "",
              seconds: Number(e.seconds) || 0,
            }))
          : [],
      };
    });

    const newScenario = await new scenarioModel({
      name: name,
      stops: processedStops,
      videoStatus: "generating",
      createdBy: user.id,
      createdByName: `${user.firstName} ${user.lastName}`,
    }).save();

    res.status(201).json({
      success: true,
      message: "Scenario created successfully. Video is being generated.",
      scenario: newScenario,
    });

    const videosDir = path.join(__dirname, "../videos");
    if (!fs.existsSync(videosDir)) {
      fs.mkdirSync(videosDir, { recursive: true });
    }

    const videoFileName = `scenario_${newScenario._id}.mp4`;
    const videoPath = path.join(videosDir, videoFileName);
    const duration = calculateScenarioDuration(processedStops);

    videoQueue.push({
      scenarioId: newScenario._id,
      scenario: newScenario,
      videoPath: videoPath,
      videoFileName: videoFileName,
      duration: duration,
    });

    console.log(
      `New scenario ${newScenario._id} created by ${user.firstName} ${user.lastName} (Duration: ${duration}s, Queue size: ${videoQueue.length})`
    );

    setImmediate(() => processVideoQueue());
  } catch (err) {
    console.log("Error:", err);
    res.status(500).json({
      success: false,
      message: err.message || "Internal server error",
    });
  }
};

const getAllScenarios = async (req, res) => {
  try {
    const user = req.user;
    const query = user.isAdmin ? {} : { createdBy: user.id };

    const scenarios = await scenarioModel
      .find(query)
      .populate("createdBy", "firstName lastName email")
      .populate("updatedBy", "firstName lastName email")
      .sort({ createdAt: -1 });

    const scenariosWithStatus = scenarios.map((scenario) => {
      const scenarioObj = scenario.toObject();
      if (videoExists(scenario._id) && scenario.videoStatus !== "completed") {
        scenarioModel
          .findByIdAndUpdate(scenario._id, {
            videoStatus: "completed",
            videoPath: `scenario_${scenario._id}.mp4`,
          })
          .catch((err) => console.error("Error updating video status:", err));
        scenarioObj.videoStatus = "completed";
        scenarioObj.videoPath = `scenario_${scenario._id}.mp4`;
      } else if (
        !videoExists(scenario._id) &&
        scenario.videoStatus === "completed"
      ) {
        scenarioModel
          .findByIdAndUpdate(scenario._id, {
            videoStatus: "failed",
          })
          .catch((err) => console.error("Error updating video status:", err));
        scenarioObj.videoStatus = "failed";
      }

      return scenarioObj;
    });

    res.status(200).json({
      success: true,
      scenarios: scenariosWithStatus,
      isAdmin: user.isAdmin,
    });
  } catch (err) {
    console.log("Error:", err);
    res.status(500).json({
      success: false,
      message: err.message || "Internal server error",
    });
  }
};

const updateScenario = async (req, res) => {
  try {
    const { name, stops } = req.body;
    const user = req.user;

    if (!name || !stops || !Array.isArray(stops) || stops.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Scenario name and at least one stop are required",
      });
    }

    const existingScenario = await scenarioModel.findById(req.params.id);

    if (!existingScenario) {
      return res.status(404).json({
        success: false,
        message: "Scenario not found",
      });
    }

    if (
      !user.isAdmin &&
      existingScenario.createdBy.toString() !== user.id.toString()
    ) {
      return res.status(403).json({
        success: false,
        message: "You don't have permission to edit this scenario",
      });
    }

    const processedStops = stops.map((stop, index) => {
      const staySeconds = Number(stop.staySeconds) || 0;
      const betweenSeconds = Number(stop.betweenSeconds) || 0;
      const durationSeconds = Number(stop.durationSeconds) || staySeconds;

      return {
        name: stop.name || `Stop ${index + 1}`,
        staySeconds: staySeconds,
        betweenSeconds: betweenSeconds,
        durationSeconds: durationSeconds,
        emergencyEnabled:
          !!(stop.emergencies && stop.emergencies.length > 0) ||
          !!stop.emergencyEnabled,
        emergencySeconds: Number(stop.emergencySeconds) || 0,
        emergencies: Array.isArray(stop.emergencies)
          ? stop.emergencies.map((e) => ({
              text: e.text || "",
              seconds: Number(e.seconds) || 0,
            }))
          : [],
      };
    });

    const normalizeStops = (stops) =>
      JSON.stringify(
        stops.map((s) => ({
          name: s.name,
          staySeconds: s.staySeconds,
          betweenSeconds: s.betweenSeconds,
          emergencies: s.emergencies,
        }))
      );

    const stopsChanged =
      normalizeStops(existingScenario.stops) !== normalizeStops(processedStops);

    const scenario = await scenarioModel
      .findByIdAndUpdate(
        req.params.id,
        {
          name: name,
          stops: processedStops,
          updatedBy: user.id,
          updatedByName: `${user.firstName} ${user.lastName}`,
          lastUpdatedAt: new Date(),
          ...(stopsChanged && { videoStatus: "generating" }),
        },
        { new: true }
      )
      .populate("createdBy", "firstName lastName email")
      .populate("updatedBy", "firstName lastName email");

    res.status(200).json({
      success: true,
      message: stopsChanged
        ? "Scenario updated successfully. Video will be regenerated shortly."
        : "Scenario updated successfully.",
      scenario: scenario,
      videoRegenerated: stopsChanged,
    });

    if (stopsChanged) {
      const videosDir = path.join(__dirname, "../videos");
      const oldVideoPath = path.join(videosDir, `scenario_${scenario._id}.mp4`);

      if (fs.existsSync(oldVideoPath)) {
        fs.unlinkSync(oldVideoPath);
        console.log(`Deleted old video for scenario ${scenario._id}`);
      }

      const videoFileName = `scenario_${scenario._id}.mp4`;
      const videoPath = path.join(videosDir, videoFileName);
      const duration = calculateScenarioDuration(processedStops);

      videoQueue = videoQueue.filter(
        (task) => task.scenarioId.toString() !== scenario._id.toString()
      );

      videoQueue.push({
        scenarioId: scenario._id,
        scenario: scenario,
        videoPath: videoPath,
        videoFileName: videoFileName,
        duration: duration,
      });

      console.log(
        `Scenario ${scenario._id} updated by ${user.firstName} ${user.lastName} (Duration: ${duration}s, Queue size: ${videoQueue.length})`
      );
      setImmediate(() => processVideoQueue());
    } else {
      console.log(
        `Scenario ${scenario._id} updated by ${user.firstName} ${user.lastName} but video not regenerated (stops unchanged)`
      );
    }
  } catch (err) {
    console.log("Error:", err);
    res.status(500).json({
      success: false,
      message: err.message || "Internal server error",
    });
  }
};

const getScenarioById = async (req, res) => {
  try {
    const user = req.user;

    const scenario = await scenarioModel
      .findById(req.params.id)
      .populate("createdBy", "firstName lastName email")
      .populate("updatedBy", "firstName lastName email");

    if (!scenario) {
      return res.status(404).json({
        success: false,
        message: "Scenario not found",
      });
    }

    if (
      !user.isAdmin &&
      scenario.createdBy._id.toString() !== user.id.toString()
    ) {
      return res.status(403).json({
        success: false,
        message: "You don't have permission to view this scenario",
      });
    }

    res.status(200).json({
      success: true,
      scenario: scenario,
    });
  } catch (err) {
    console.log("Error:", err);
    res.status(500).json({
      success: false,
      message: err.message || "Internal server error",
    });
  }
};

const deleteScenario = async (req, res) => {
  try {
    const user = req.user; // From auth middleware

    const scenario = await scenarioModel.findById(req.params.id);

    if (!scenario) {
      return res.status(404).json({
        success: false,
        message: "Scenario not found",
      });
    }

    if (!user.isAdmin && scenario.createdBy.toString() !== user.id.toString()) {
      return res.status(403).json({
        success: false,
        message: "You don't have permission to delete this scenario",
      });
    }

    await scenarioModel.findByIdAndDelete(req.params.id);
    const initialQueueLength = videoQueue.length;
    videoQueue = videoQueue.filter(
      (task) => task.scenarioId.toString() !== req.params.id
    );

    if (videoQueue.length < initialQueueLength) {
      console.log(`Removed scenario ${req.params.id} from generation queue`);
    }
    const videosDir = path.join(__dirname, "../videos");
    const videoPath = path.join(videosDir, `scenario_${scenario._id}.mp4`);

    if (fs.existsSync(videoPath)) {
      fs.unlinkSync(videoPath);
      console.log(`Deleted video file for scenario ${scenario._id}`);
    }

    console.log(
      `Scenario ${scenario._id} deleted by ${user.firstName} ${user.lastName}`
    );

    res.status(200).json({
      success: true,
      message: "Scenario deleted successfully",
    });
  } catch (err) {
    console.log("Error:", err);
    res.status(500).json({
      success: false,
      message: err.message || "Internal server error",
    });
  }
};

const generateScenarioVideo = async (req, res) => {
  try {
    const user = req.user;

    const scenario = await scenarioModel.findById(req.params.id);

    if (!scenario) {
      return res.status(404).json({
        success: false,
        message: "Scenario not found",
      });
    }

    if (!user.isAdmin && scenario.createdBy.toString() !== user.id.toString()) {
      return res.status(403).json({
        success: false,
        message: "You don't have permission to download this scenario",
      });
    }

    const videosDir = path.join(__dirname, "../videos");
    const videoPath = path.join(videosDir, `scenario_${scenario._id}.mp4`);

    if (!fs.existsSync(videoPath)) {
      const inQueue = videoQueue.some(
        (task) => task.scenarioId.toString() === scenario._id.toString()
      );

      if (inQueue || scenario.videoStatus === "generating") {
        return res.status(404).json({
          success: false,
          message: "Video is being generated. Please try again in a moment.",
        });
      }

      return res.status(404).json({
        success: false,
        message: "Video not found. Please regenerate the video.",
      });
    }

    res.download(videoPath, `${scenario.name}.mp4`, (err) => {
      if (err) {
        console.error("Download error:", err);
      }
    });
  } catch (err) {
    console.log("Error:", err);
    res.status(500).json({
      success: false,
      message: err.message || "Failed to download video",
    });
  }
};

const getQueueStatus = async (req, res) => {
  try {
    res.status(200).json({
      success: true,
      queueLength: videoQueue.length,
      isProcessing: isProcessingQueue,
      queue: videoQueue.map((task) => ({
        scenarioId: task.scenarioId,
        duration: task.duration,
        scenarioName: task.scenario.name,
      })),
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message || "Internal server error",
    });
  }
};

module.exports = {
  createScenario,
  getAllScenarios,
  getScenarioById,
  updateScenario,
  deleteScenario,
  generateScenarioVideo,
  getQueueStatus,
};

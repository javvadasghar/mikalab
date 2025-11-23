const express = require("express");
const router = express.Router();
const {
  createScenario,
  getAllScenarios,
  getScenarioById,
  updateScenario,
  deleteScenario,
  generateScenarioVideo,
  getQueueStatus
} = require("../controllers/ScenerioController");
const { authenticateUser } = require("../controllers/userController");
router.post("/", authenticateUser, createScenario);
router.get("/", authenticateUser, getAllScenarios);
router.get("/queue-status", authenticateUser, getQueueStatus);
router.get("/:id", authenticateUser, getScenarioById);
router.put("/:id", authenticateUser, updateScenario);
router.delete("/:id", authenticateUser, deleteScenario);
router.get("/:id/video", authenticateUser, generateScenarioVideo);

module.exports = router;
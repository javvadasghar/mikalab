var express = require("express");
var router = express.Router();
var userController = require("../controllers/userController");
const { authenticateUser, requireAdmin } = require("../middleware/authMiddleware");
router.post("/login", userController.loginUser);
router.post("/", authenticateUser, requireAdmin, userController.createUser);
router.get("/", authenticateUser, requireAdmin, userController.getAllUsers);
router.delete("/:id", authenticateUser, requireAdmin, userController.deleteUser);

module.exports = router;

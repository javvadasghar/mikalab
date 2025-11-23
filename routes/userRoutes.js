var express = require("express");
var router = express.Router();
var userController = require("../controllers/userController");

router.post("/", userController.createUser);
router.post("/login", userController.loginUser);
router.get("/", userController.getAllUsers);
router.delete('/:id', userController.deleteUser);

module.exports = router;
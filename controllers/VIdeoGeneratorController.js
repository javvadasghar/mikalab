const { createCanvas } = require("canvas");
const ffmpeg = require("fluent-ffmpeg");
const fs = require("fs");
const path = require("path");

class VideoGenerator {
  constructor() {
    this.width = 1920;
    this.height = 1080;
    this.fps = 0.05;
  }

  async generateStopFrame(stopName, currentStop, totalStops, timeRemaining) {
    const canvas = createCanvas(this.width, this.height);
    const ctx = canvas.getContext("2d");

    // Background
    ctx.fillStyle = "#1a1a2e";
    ctx.fillRect(0, 0, this.width, this.height);

    // Header
    ctx.fillStyle = "#0f3460";
    ctx.fillRect(0, 0, this.width, 200);

    // Title
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 80px Arial";
    ctx.textAlign = "center";
    ctx.fillText("NEXT STOP", this.width / 2, 120);

    // Stop Name
    ctx.fillStyle = "#16c79a";
    ctx.font = "bold 120px Arial";
    ctx.fillText(stopName, this.width / 2, 400);

    // Stop Counter
    ctx.fillStyle = "#ffffff";
    ctx.font = "60px Arial";
    ctx.fillText(`Stop ${currentStop} of ${totalStops}`, this.width / 2, 550);

    // Time Remaining
    ctx.fillStyle = "#f5f5f5";
    ctx.font = "bold 80px Arial";
    ctx.fillText(`${timeRemaining}s`, this.width / 2, 750);

    // Progress Bar
    const barWidth = 1200;
    const barHeight = 40;
    const barX = (this.width - barWidth) / 2;
    const barY = 850;

    ctx.fillStyle = "#2d4059";
    ctx.fillRect(barX, barY, barWidth, barHeight);

    const progress = (currentStop - 1) / totalStops;
    ctx.fillStyle = "#16c79a";
    ctx.fillRect(barX, barY, barWidth * progress, barHeight);

    return canvas.toBuffer("image/png");
  }

  async generateVideo(scenario, outputPath) {
    const tempDir = path.join(__dirname, "../temp", `scenario_${Date.now()}`);

    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    try {
      let frameIndex = 0;
      const stops = scenario.stops;
      for (let i = 0; i < stops.length; i++) {
        const stop = stops[i];
        const totalFrames = stop.travelTimeToNextStop * this.fps;

        for (let frame = 0; frame < totalFrames; frame++) {
          const timeRemaining = Math.ceil((totalFrames - frame) / this.fps);
          const frameBuffer = await this.generateStopFrame(
            stop.name,
            i + 1,
            stops.length,
            timeRemaining,
          );

          const framePath = path.join(
            tempDir,
            `frame_${String(frameIndex).padStart(6, "0")}.png`,
          );
          fs.writeFileSync(framePath, frameBuffer);
          frameIndex++;
        }
      }

      return new Promise((resolve, reject) => {
        ffmpeg()
          .input(path.join(tempDir, "frame_%06d.png"))
          .inputFPS(this.fps)
          .videoCodec("libx264")
          .outputOptions("-pix_fmt yuv420p")
          .output(outputPath)
          .on("end", () => {
            fs.rmSync(tempDir, { recursive: true, force: true });
            resolve(outputPath);
          })
          .on("error", (err) => {
            fs.rmSync(tempDir, { recursive: true, force: true });
            reject(err);
          })
          .run();
      });
    } catch (error) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      throw error;
    }
  }
}

module.exports = new VideoGenerator();

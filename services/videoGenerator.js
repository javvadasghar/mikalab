const { createCanvas } = require("canvas");
const ffmpeg = require("fluent-ffmpeg");
const fs = require("fs");
const path = require("path");

class VideoGenerator {
  constructor() {
    this.width = 1920;
    this.height = 1080;
    this.fps = 10;
  }

  async generateStopFrame(
    currentStop,
    totalStops,
    stops,
    routeName,
    elapsedSeconds
  ) {
    const canvas = createCanvas(this.width, this.height);
    const ctx = canvas.getContext("2d");
    let cumulativeTimes = [0];
    for (let i = 0; i < stops.length; i++) {
      cumulativeTimes.push(cumulativeTimes[i] + stops[i].durationSeconds);
    }

    let currentStopIndex = 0;
    for (let i = 0; i < cumulativeTimes.length - 1; i++) {
      if (
        elapsedSeconds >= cumulativeTimes[i] &&
        elapsedSeconds < cumulativeTimes[i + 1]
      ) {
        currentStopIndex = i;
        break;
      }
    }

    ctx.fillStyle = "#3c3c3c";
    ctx.fillRect(0, 0, this.width, this.height);

    const headerHeight = 120;
    ctx.fillStyle = "#7a7a7a";
    ctx.fillRect(34, 34, this.width - 68, headerHeight);
    ctx.fillStyle = "#ff8800";
    ctx.beginPath();
    ctx.moveTo(90, 50);
    ctx.lineTo(150, 50);
    ctx.lineTo(180, 94);
    ctx.lineTo(150, 138);
    ctx.lineTo(90, 138);
    ctx.lineTo(60, 94);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 70px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("M", 120, 94);

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 56px Arial";
    ctx.textAlign = "left";
    ctx.fillText(`${stops[currentStopIndex].name}`, 235, 100);

    const nextStopStartIndex = currentStopIndex + 1;
    const visibleStops = stops.slice(
      nextStopStartIndex,
      nextStopStartIndex + 3
    );
    const visibleStopsCount = visibleStops.length;

    const lineX = 120;
    const startY = 200;
    const bottomY = this.height - 280;
    const stopSpacing =
      visibleStopsCount > 1 ? (bottomY - startY) / (visibleStopsCount - 1) : 0;

    if (visibleStopsCount > 0) {
      ctx.strokeStyle = "#ff8800";
      ctx.lineWidth = 12;
      ctx.beginPath();
      ctx.moveTo(lineX, startY);
      ctx.lineTo(lineX, visibleStopsCount === 1 ? startY : bottomY);
      ctx.stroke();
    }

    ctx.textAlign = "left";
    for (let i = 0; i < visibleStopsCount; i++) {
      const actualIndex = nextStopStartIndex + i;
      const y = visibleStopsCount === 1 ? startY : startY + i * stopSpacing;

      let remainingTime = cumulativeTimes[actualIndex] - elapsedSeconds;

      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(lineX, y, 20, 0, Math.PI * 2);
      ctx.fill();

      if (i === 0) {
        ctx.strokeStyle = "#ff8800";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(lineX, y, 24, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.fillStyle = "#ffffff";
      ctx.font = i === 0 ? "bold 56px Arial" : "56px Arial";
      ctx.fillText(visibleStops[i].name, 235, y + 15);
      ctx.fillStyle = "#ffffff";
      ctx.font = "56px Arial";
      ctx.textAlign = "right";
      const seconds = Math.ceil(remainingTime);
      ctx.fillText(`${seconds} Sec.`, this.width - 100, y + 15);
      ctx.textAlign = "left";
    }

    const bottomBarHeight = 150;
    const bottomMargin = 24;
    const bottomBarY = this.height - bottomBarHeight - bottomMargin;
    ctx.fillStyle = "#7a7a7a";
    ctx.fillRect(34, bottomBarY, this.width - 68, bottomBarHeight);

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 64px Arial";
    ctx.textAlign = "left";
    const finalStopName = stops[stops.length - 1].name;
    ctx.fillText(finalStopName, 100, bottomBarY + 70);

    const remainingTimeToEnd = cumulativeTimes[stops.length] - elapsedSeconds;
    const remainingSecondsToEnd = Math.ceil(remainingTimeToEnd);

    ctx.font = "bold 56px Arial";
    ctx.textAlign = "right";
    ctx.fillText(
      `${remainingSecondsToEnd} Sec.`,
      this.width - 100,
      bottomBarY + 70
    );
    ctx.textAlign = "left";

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
      const routeName =
        scenario.stops &&
        scenario.stops.length > 0 &&
        scenario.stops[scenario.stops.length - 1].name;
      const totalDuration = stops.reduce(
        (sum, stop) => sum + stop.durationSeconds,
        0
      );
      const totalFrames = totalDuration * this.fps;

      for (let frame = 0; frame < totalFrames; frame++) {
        const elapsedSeconds = frame / this.fps;

        const frameBuffer = await this.generateStopFrame(
          0,
          stops.length,
          stops,
          routeName,
          elapsedSeconds
        );

        const framePath = path.join(
          tempDir,
          `frame_${String(frameIndex).padStart(6, "0")}.png`
        );
        fs.writeFileSync(framePath, frameBuffer);
        frameIndex++;
      }

      return new Promise((resolve, reject) => {
        ffmpeg()
          .input(path.join(tempDir, "frame_%06d.png"))
          .inputFPS(this.fps)
          .videoCodec("libx264")
          .outputOptions(["-pix_fmt yuv420p", "-preset ultrafast", "-crf 23"])
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

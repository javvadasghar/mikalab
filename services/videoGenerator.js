const { createCanvas } = require("canvas");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");
const fs = require("fs");
const path = require("path");
const gtts = require("gtts");
ffmpeg.setFfmpegPath(ffmpegPath);

class VideoGenerator {
  constructor() {
    this.width = 1920;
    this.height = 1080;
    this.fps = 0.5;

    this.themes = {
      dark: {
        background: "#222121ff",
        header: "#7a7a7a",
        accent: "#ff8800",
        text: "#ffffff",
        departure: "#ffffff",
        footer: "#7a7a7a",
      },
      light: {
        background: "#f5f5f5",
        header: "#ffffff",
        accent: "#ff8800",
        text: "#000000",
        departure: "#000000",
        footer: "#ffffff",
      },
    };
  }

  formatTime(seconds) {
    const mins = Math.ceil(seconds / 60);
    return `${mins} Min.`;
  }

  async generateAudioAnnouncement(text, outputPath) {
    return new Promise((resolve, reject) => {
      try {
        const speech = new gtts(text, "en");
        speech.save(outputPath, (err) => {
          if (err) {
            reject(err);
          } else {
            resolve(outputPath);
          }
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  async createAudioTimeline(stops, tempDir) {
    const audioFiles = [];
    const emergencyAudioFiles = [];

    let logicalTime = 0;
    const stopArrivalTimes = [0];

    for (let i = 0; i < stops.length; i++) {
      const stop = stops[i];
      const isLastStop = i === stops.length - 1;

      if (!isLastStop) {
        const stayTime = Number(stop.stayTimeAtStop) || 0;
        const travelTime = Number(stop.travelTimeToNextStop) || 0;
        logicalTime += stayTime + travelTime;
        stopArrivalTimes.push(logicalTime);
      }
    }

    const emergencies = [];
    for (let i = 0; i < stops.length; i++) {
      const stop = stops[i];
      if (stop.emergencies && Array.isArray(stop.emergencies)) {
        for (const emergency of stop.emergencies) {
          const emergencyStart = Number(emergency.startSecond) || 0;
          const emergencyDuration = Number(emergency.seconds) || 0;
          if (emergencyDuration > 0) {
            emergencies.push({
              logicalStart: emergencyStart,
              duration: emergencyDuration,
              text: emergency.text || "Emergency alert",
              stopIndex: i,
            });
          }
        }
      }
    }
    emergencies.sort((a, b) => a.logicalStart - b.logicalStart);
    const physicalArrivalTimes = [];
    for (let i = 0; i < stopArrivalTimes.length; i++) {
      let logicalArrival = stopArrivalTimes[i];
      let addedTime = 0;

      for (const emergency of emergencies) {
        if (emergency.logicalStart < logicalArrival) {
          addedTime += emergency.duration;
        }
      }

      physicalArrivalTimes.push(logicalArrival + addedTime);
    }

    for (let i = 0; i < stops.length; i++) {
      const stop = stops[i];
      const isLastStop = i === stops.length - 1;

      if (i === 0) {
        continue;
      }

      const announcementText = isLastStop
        ? `Arriving at final stop, ${stop.name}, Please leave the bus, thank you for riding with us.`
        : `Next stop, ${stop.name}`;

      const audioPath = path.join(tempDir, `announcement_${i}.mp3`);

      try {
        await this.generateAudioAnnouncement(announcementText, audioPath);
        const physicalArrival = physicalArrivalTimes[i];
        const announcementTime = Math.max(0, physicalArrival - 5);
        audioFiles.push({
          path: audioPath,
          startTime: announcementTime,
          stopName: stop.name,
          stopIndex: i,
          isEmergency: false,
        });
      } catch (error) {
        console.error(`Error generating audio for stop ${stop.name}:`, error);
      }
    }
    for (const emergency of emergencies) {
      const audioPath = path.join(
        tempDir,
        `emergency_${emergency.stopIndex}.mp3`,
      );

      try {
        await this.generateAudioAnnouncement(
          `Emergency. ${emergency.text}. Please remain calm and wait for the further instructions. Thank you.`,
          audioPath,
        );
        let addedTimeBefore = 0;
        for (const prevEmergency of emergencies) {
          if (prevEmergency.logicalStart < emergency.logicalStart) {
            addedTimeBefore += prevEmergency.duration;
          }
        }

        const physicalStartTime = emergency.logicalStart + addedTimeBefore;

        emergencyAudioFiles.push({
          path: audioPath,
          startTime: physicalStartTime,
          duration: emergency.duration,
          stopName: stops[emergency.stopIndex].name,
          stopIndex: emergency.stopIndex,
          isEmergency: true,
        });
      } catch (error) {
        console.error(`Error generating emergency audio:`, error);
      }
    }

    return audioFiles.concat(emergencyAudioFiles);
  }

  async mergeAudioFiles(audioFiles, totalDuration, outputPath) {
    if (audioFiles.length === 0) {
      return null;
    }

    return new Promise((resolve, reject) => {
      try {
        const filterComplex = [];
        const inputs = [`anullsrc=r=44100:cl=stereo:d=${totalDuration}`];
        let inputIndex = 1;

        const command = ffmpeg();
        command
          .input(`anullsrc=r=44100:cl=stereo:d=${totalDuration}`)
          .inputFormat("lavfi");

        audioFiles.forEach((audio, index) => {
          const delay = Math.floor(audio.startTime * 1000);

          command.input(audio.path);

          if (audio.isEmergency && audio.duration) {
            filterComplex.push(
              `[${inputIndex}:a]adelay=${delay}|${delay}[a${index}]`,
            );
            inputIndex++;
            const sirenPath = path.join(__dirname, "../media/siren-alert.mp3");
            const sirenDuration = audio.duration;

            command.input(sirenPath);

            filterComplex.push(
              `[${inputIndex}:a]aloop=loop=-1:size=2e+09,atrim=0:${sirenDuration},volume=0.4,adelay=${delay}|${delay}[siren${index}]`,
            );
            inputIndex++;

            filterComplex.push(
              `[a${index}][siren${index}]amix=inputs=2:duration=longest[emergency${index}]`,
            );
          } else {
            filterComplex.push(
              `[${inputIndex}:a]adelay=${delay}|${delay}[a${index}]`,
            );
            inputIndex++;
          }
        });

        const mixInputs = audioFiles
          .map((audio, index) => {
            if (audio.isEmergency && audio.duration) {
              return `[emergency${index}]`;
            }
            return `[a${index}]`;
          })
          .join("");

        filterComplex.push(
          `[0:a]${mixInputs}amix=inputs=${audioFiles.length + 1}:duration=longest[outa]`,
        );

        command
          .complexFilter(filterComplex)
          .outputOptions(["-map", "[outa]"])
          .audioCodec("aac")
          .output(outputPath)
          .on("end", () => resolve(outputPath))
          .on("error", (err) => reject(err))
          .run();
      } catch (error) {
        reject(error);
      }
    });
  }

  async generateStopFrame(
    currentStop,
    totalStops,
    stops,
    routeName,
    elapsedSeconds,
    theme = "dark",
  ) {
    const canvas = createCanvas(this.width, this.height);
    const ctx = canvas.getContext("2d");
    const colors = this.themes[theme] || this.themes.dark;
    let logicalTimeline = [];
    let logicalTime = 0;

    for (let i = 0; i < stops.length; i++) {
      const stop = stops[i];
      const isLastStop = i === stops.length - 1;

      const stayAtStopDuration = Number(stop.stayTimeAtStop) || 0;
      if (!isLastStop && stayAtStopDuration > 0) {
        logicalTimeline.push({
          type: "stay",
          stopIndex: i,
          logicalStart: logicalTime,
          logicalEnd: logicalTime + stayAtStopDuration,
          duration: stayAtStopDuration,
        });
        logicalTime += stayAtStopDuration;
      }

      const travelToNextStopDuration = Number(stop.travelTimeToNextStop) || 0;
      if (!isLastStop && i < stops.length - 1 && travelToNextStopDuration > 0) {
        logicalTimeline.push({
          type: "travel",
          stopIndex: i,
          nextStopIndex: i + 1,
          logicalStart: logicalTime,
          logicalEnd: logicalTime + travelToNextStopDuration,
          duration: travelToNextStopDuration,
        });
        logicalTime += travelToNextStopDuration;
      }
    }

    let emergencies = [];
    for (let i = 0; i < stops.length; i++) {
      const stop = stops[i];
      if (stop.emergencies && Array.isArray(stop.emergencies)) {
        for (const emergency of stop.emergencies) {
          const emergencyStart = Number(emergency.startSecond) || 0;
          const emergencyDuration = Number(emergency.seconds) || 0;
          if (emergencyDuration > 0) {
            emergencies.push({
              logicalStart: emergencyStart,
              duration: emergencyDuration,
              text: emergency.text || "",
              stopIndex: i,
            });
          }
        }
      }
    }
    emergencies.sort((a, b) => a.logicalStart - b.logicalStart);

    let timeline = [];
    let physicalTime = 0;
    let emergencyIndex = 0;

    for (const logicalPhase of logicalTimeline) {
      let phaseLogicalStart = logicalPhase.logicalStart;
      let phaseLogicalEnd = logicalPhase.logicalEnd;
      let phaseDuration = phaseLogicalEnd - phaseLogicalStart;
      let phaseElapsed = 0;
      while (emergencyIndex < emergencies.length) {
        const emergency = emergencies[emergencyIndex];

        if (emergency.logicalStart >= phaseLogicalEnd) {
          break;
        }

        if (
          emergency.logicalStart >= phaseLogicalStart &&
          emergency.logicalStart < phaseLogicalEnd
        ) {
          const beforeEmergency = emergency.logicalStart - phaseLogicalStart;

          if (beforeEmergency > 0) {
            timeline.push({
              type: logicalPhase.type,
              stopIndex: logicalPhase.stopIndex,
              nextStopIndex: logicalPhase.nextStopIndex,
              startTime: physicalTime,
              endTime: physicalTime + beforeEmergency,
              duration: beforeEmergency,
              phaseProgress: phaseElapsed,
              totalPhaseDuration: phaseDuration,
            });
            physicalTime += beforeEmergency;
            phaseElapsed += beforeEmergency;
            phaseLogicalStart += beforeEmergency;
          }

          timeline.push({
            type: "emergency",
            stopIndex: emergency.stopIndex,
            startTime: physicalTime,
            endTime: physicalTime + emergency.duration,
            duration: emergency.duration,
            emergencyText: emergency.text,
          });
          physicalTime += emergency.duration;
          emergencyIndex++;
        } else {
          emergencyIndex++;
        }
      }

      const remainingDuration = phaseLogicalEnd - phaseLogicalStart;
      if (remainingDuration > 0) {
        timeline.push({
          type: logicalPhase.type,
          stopIndex: logicalPhase.stopIndex,
          nextStopIndex: logicalPhase.nextStopIndex,
          startTime: physicalTime,
          endTime: physicalTime + remainingDuration,
          duration: remainingDuration,
          phaseProgress: phaseElapsed,
          totalPhaseDuration: phaseDuration,
        });
        physicalTime += remainingDuration;
      }
    }

    if (elapsedSeconds === 0) {
      timeline.map((p) => ({
        type: p.type,
        start: p.startTime,
        end: p.endTime,
        text: p.emergencyText || "N/A",
      }));
    }

    let currentPhase = timeline[0];
    for (const phase of timeline) {
      if (elapsedSeconds >= phase.startTime && elapsedSeconds < phase.endTime) {
        currentPhase = phase;
        break;
      }
    }

    if (!currentPhase && timeline.length > 0) {
      currentPhase = timeline[timeline.length - 1];
    }

    const isEmergency = currentPhase && currentPhase.type === "emergency";
    const currentStopIndex = currentPhase ? currentPhase.stopIndex : 0;
    const displayStopIndex = currentStopIndex;
    const currentStopData = stops[displayStopIndex];
    if (!currentStopData) {
      const canvas = createCanvas(this.width, this.height);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = colors.background;
      ctx.fillRect(0, 0, this.width, this.height);
      return canvas.toBuffer("image/png");
    }

    ctx.fillStyle = colors.background;
    ctx.fillRect(0, 0, this.width, this.height);

    if (!isEmergency) {
      const headerHeight = 120;
      ctx.fillStyle = colors.header;
      ctx.fillRect(50, 50, this.width - 100, headerHeight);
      ctx.fillStyle = colors.accent;
      ctx.beginPath();
      ctx.moveTo(106, 66);
      ctx.lineTo(166, 66);
      ctx.lineTo(196, 110);
      ctx.lineTo(166, 154);
      ctx.lineTo(106, 154);
      ctx.lineTo(76, 110);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = colors.text;
      ctx.font = "bold 70px Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("M", 136, 110);

      ctx.fillStyle = colors.text;
      ctx.font = "bold 56px Arial";
      ctx.textAlign = "left";
      ctx.fillText(`${currentStopData.name}`, 251, 116);
      ctx.textAlign = "right";

      const currentStopStayPhases = timeline.filter(
        (p) => p.type === "stay" && p.stopIndex === currentStopIndex,
      );

      if (currentStopStayPhases.length > 0) {
        const lastStayPhase =
          currentStopStayPhases[currentStopStayPhases.length - 1];
        const departureTime = lastStayPhase.endTime;
        const remainingTime = Math.max(
          0,
          Math.ceil(departureTime - elapsedSeconds),
        );
        if (remainingTime > 0) {
          ctx.fillStyle = colors.departure;
          ctx.font = "bold 48px Arial";
          ctx.fillText(
            `Departure in: ${this.formatTime(remainingTime)}`,
            this.width - 120,
            116,
          );
        }
      }
    }

    if (isEmergency) {
      const emergencyMessage = currentPhase.emergencyText || "EMERGENCY";
      const emergencyY = 0;
      const emergencyHeight = this.height;

      const pulseIntensity = Math.abs(Math.sin(elapsedSeconds * 3)) * 0.3 + 0.7;
      const gradient = ctx.createLinearGradient(
        0,
        emergencyY,
        0,
        emergencyY + emergencyHeight,
      );
      gradient.addColorStop(0, `rgba(220, 38, 38, ${pulseIntensity})`);
      gradient.addColorStop(0.5, `rgba(185, 28, 28, ${pulseIntensity})`);
      gradient.addColorStop(1, `rgba(153, 27, 27, ${pulseIntensity})`);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, emergencyY, this.width, emergencyHeight);
      ctx.strokeStyle = "#fbbf24";
      ctx.lineWidth = 12;
      const stripeOffset = (elapsedSeconds * 100) % 100;
      for (let i = -5; i < 30; i++) {
        const x = i * 100 - stripeOffset;
        ctx.beginPath();
        ctx.moveTo(x, emergencyY);
        ctx.lineTo(x + emergencyHeight, emergencyY + emergencyHeight);
        ctx.stroke();
      }

      const flashIntensity =
        Math.abs(Math.sin(elapsedSeconds * 4)) > 0.5 ? 1 : 0.4;
      ctx.strokeStyle = `rgba(251, 191, 36, ${flashIntensity})`;
      ctx.lineWidth = 15;
      ctx.strokeRect(
        20,
        emergencyY + 20,
        this.width - 40,
        emergencyHeight - 40,
      );

      ctx.strokeStyle = `rgba(255, 255, 0, ${flashIntensity * 0.8})`;
      ctx.lineWidth = 8;
      ctx.strokeRect(
        35,
        emergencyY + 35,
        this.width - 70,
        emergencyHeight - 70,
      );

      const iconSize = 100 + Math.sin(elapsedSeconds * 5) * 20;
      ctx.fillStyle = "#fbbf24";
      ctx.font = `bold ${iconSize}px Arial`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      ctx.shadowColor = "rgba(251, 191, 36, 0.8)";
      ctx.shadowBlur = 30;
      ctx.fillText("⚠", this.width / 2, emergencyY + 150);

      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 72px Arial";
      ctx.shadowColor = "rgba(0, 0, 0, 0.9)";
      ctx.shadowBlur = 15;
      ctx.shadowOffsetX = 4;
      ctx.shadowOffsetY = 4;

      const maxWidth = this.width - 200;
      const words = emergencyMessage.split(" ");
      let line = "";
      let y = emergencyY + 280;
      const lineHeight = 85;

      for (let i = 0; i < words.length; i++) {
        const testLine = line + words[i] + " ";
        const metrics = ctx.measureText(testLine);

        if (metrics.width > maxWidth && i > 0) {
          ctx.fillText(line, this.width / 2, y);
          line = words[i] + " ";
          y += lineHeight;
        } else {
          line = testLine;
        }
      }
      ctx.fillText(line, this.width / 2, y);
      ctx.fillStyle = "#fbbf24";
      ctx.font = "bold 48px Arial";
      ctx.fillText("🚨 EMERGENCY 🚨", this.width / 2, emergencyY + 160);
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
    } else {
      const nextStopStartIndex = displayStopIndex + 1;
      const visibleStops = stops.slice(
        nextStopStartIndex,
        nextStopStartIndex + 3,
      );
      const visibleStopsCount = visibleStops.length;

      const lineX = 136;
      const startY = 230;
      const bottomY = this.height - 320;
      const stopSpacing =
        visibleStopsCount > 1
          ? (bottomY - startY) / (visibleStopsCount - 1)
          : 0;

      if (visibleStopsCount > 0) {
        ctx.strokeStyle = colors.accent;
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
        let arrivalTime = 0;
        const travelPhasesToStop = timeline.filter(
          (p) => p.type === "travel" && p.nextStopIndex === actualIndex,
        );

        if (travelPhasesToStop.length > 0) {
          const lastTravelPhase =
            travelPhasesToStop[travelPhasesToStop.length - 1];
          arrivalTime = lastTravelPhase.endTime;
        } else {
          const firstStayAtStop = timeline.find(
            (p) => p.type === "stay" && p.stopIndex === actualIndex,
          );
          if (firstStayAtStop) {
            arrivalTime = firstStayAtStop.startTime;
          }
        }

        let remainingTime = Math.max(0, arrivalTime - elapsedSeconds);

        ctx.fillStyle = colors.text;
        ctx.beginPath();
        ctx.arc(lineX, y, 20, 0, Math.PI * 2);
        ctx.fill();

        if (i === 0) {
          ctx.strokeStyle = colors.accent;
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.arc(lineX, y, 24, 0, Math.PI * 2);
          ctx.stroke();
        }

        ctx.fillStyle = colors.text;
        ctx.font = i === 0 ? "bold 56px Arial" : "56px Arial";
        ctx.fillText(visibleStops[i].name, 251, y + 15);
        ctx.fillStyle = colors.text;
        ctx.font = "56px Arial";
        ctx.textAlign = "right";
        const seconds = Math.max(0, Math.ceil(remainingTime));
        ctx.fillText(this.formatTime(seconds), this.width - 120, y + 15);
        ctx.textAlign = "left";
      }
    }

    if (!isEmergency) {
      const bottomBarHeight = 150;
      const bottomMargin = 50;
      const bottomBarY = this.height - bottomBarHeight - bottomMargin;
      ctx.fillStyle = colors.footer;
      ctx.fillRect(50, bottomBarY, this.width - 100, bottomBarHeight);

      ctx.fillStyle = colors.text;
      ctx.font = "bold 64px Arial";
      ctx.textAlign = "left";
      const finalStopName = stops[stops.length - 1].name;
      ctx.fillText(finalStopName, 120, bottomBarY + 70);
      const lastStopIndex = stops.length - 1;
      let arrivalTimeAtFinalStop = 0;
      const travelPhasesToLastStop = timeline.filter(
        (p) => p.type === "travel" && p.nextStopIndex === lastStopIndex,
      );

      if (travelPhasesToLastStop.length > 0) {
        const lastTravelPhase =
          travelPhasesToLastStop[travelPhasesToLastStop.length - 1];
        arrivalTimeAtFinalStop = lastTravelPhase.endTime;
      } else {
        const firstStayAtLastStop = timeline.find(
          (p) => p.type === "stay" && p.stopIndex === lastStopIndex,
        );
        if (firstStayAtLastStop) {
          arrivalTimeAtFinalStop = firstStayAtLastStop.startTime;
        } else {
          arrivalTimeAtFinalStop =
            timeline.length > 0 ? timeline[timeline.length - 1].endTime : 0;
        }
      }

      const remainingTimeToFinalStop = Math.max(
        0,
        arrivalTimeAtFinalStop - elapsedSeconds,
      );
      const remainingSecondsToFinalStop = Math.ceil(remainingTimeToFinalStop);

      ctx.font = "bold 56px Arial";
      ctx.textAlign = "right";
      ctx.fillText(
        this.formatTime(remainingSecondsToFinalStop),
        this.width - 120,
        bottomBarY + 70,
      );
      ctx.textAlign = "left";
    }

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

      let totalDuration = 0;

      for (let i = 0; i < stops.length; i++) {
        const isLastStop = i === stops.length - 1;

        const stayAtStopDuration = Number(stops[i].stayTimeAtStop) || 0;
        const travelToNextStopDuration =
          Number(stops[i].travelTimeToNextStop) || 0;

        if (!isLastStop) {
          totalDuration += stayAtStopDuration;
        }

        if (!isLastStop && i < stops.length - 1) {
          totalDuration += travelToNextStopDuration;
        }
      }

      for (let i = 0; i < stops.length; i++) {
        if (stops[i].emergencies && Array.isArray(stops[i].emergencies)) {
          for (const emergency of stops[i].emergencies) {
            const emergencyDuration = Number(emergency.seconds) || 0;
            totalDuration += emergencyDuration;
          }
        }
      }

      const totalFrames = totalDuration * this.fps;
      const audioFiles = await this.createAudioTimeline(stops, tempDir);
      for (let frame = 0; frame < totalFrames; frame++) {
        const elapsedSeconds = frame / this.fps;

        const frameBuffer = await this.generateStopFrame(
          0,
          stops.length,
          stops,
          routeName,
          elapsedSeconds,
          scenario.theme || "dark",
        );

        const framePath = path.join(
          tempDir,
          `frame_${String(frameIndex).padStart(6, "0")}.png`,
        );
        fs.writeFileSync(framePath, frameBuffer);
        frameIndex++;
      }

      const videoOnlyPath = path.join(tempDir, "video_only.mp4");
      const mergedAudioPath = path.join(tempDir, "merged_audio.aac");
      await new Promise((resolve, reject) => {
        ffmpeg()
          .input(path.join(tempDir, "frame_%06d.png"))
          .inputFPS(this.fps)
          .videoCodec("libx264")
          .outputOptions([
            "-pix_fmt yuv420p",
            "-preset ultrafast",
            "-crf 28",
            "-tune stillimage",
          ])
          .output(videoOnlyPath)
          .on("end", () => resolve(videoOnlyPath))
          .on("error", (err) => reject(err))
          .run();
      });

      if (audioFiles.length > 0) {
        await this.mergeAudioFiles(audioFiles, totalDuration, mergedAudioPath);

        await new Promise((resolve, reject) => {
          ffmpeg()
            .input(videoOnlyPath)
            .input(mergedAudioPath)
            .outputOptions(["-c:v copy", "-c:a aac", "-shortest"])
            .output(outputPath)
            .on("end", () => resolve(outputPath))
            .on("error", (err) => reject(err))
            .run();
        });
      } else {
        fs.copyFileSync(videoOnlyPath, outputPath);
      }

      fs.rmSync(tempDir, { recursive: true, force: true });
      console.log("Video generation complete!");
      return outputPath;
    } catch (error) {
      console.error("Error in generateVideo:", error);
      fs.rmSync(tempDir, { recursive: true, force: true });
      throw error;
    }
  }
}

module.exports = new VideoGenerator();

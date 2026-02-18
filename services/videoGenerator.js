const { createCanvas } = require("canvas");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");
const fs = require("fs");
const fsPromises = require("fs").promises;
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

  async createAudioTimeline(stops, emergencies, tempDir) {
    const audioFiles = [];
    const emergencyAudioFiles = [];
    const hasEmergencies =
      emergencies && Array.isArray(emergencies) && emergencies.length > 0;
    if (!hasEmergencies) {
      const welcomeAudioPath = path.join(tempDir, "welcome.mp3");
      const finalDestination = stops[stops.length - 1].name;
      try {
        await this.generateAudioAnnouncement(
          `Welcome aboard. This bus is heading to ${finalDestination}. Please remain seated and enjoy your journey.`,
          welcomeAudioPath,
        );
        audioFiles.push({
          path: welcomeAudioPath,
          startTime: 0,
          stopName: "Welcome",
          stopIndex: -1,
          isEmergency: false,
        });
      } catch (error) {
        console.error("Error generating welcome audio:", error);
      }
    }

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

    const processedEmergencies = [];
    if (emergencies && Array.isArray(emergencies)) {
      for (const emergency of emergencies) {
        const emergencyStart = Number(emergency.startSecond) || 0;
        const emergencyDuration = Number(emergency.seconds) || 0;
        if (emergencyDuration > 0) {
          processedEmergencies.push({
            logicalStart: emergencyStart,
            duration: emergencyDuration,
            text: emergency.text || "Emergency alert",
            type: emergency.type || "danger",
          });
        }
      }
    }
    processedEmergencies.sort((a, b) => a.logicalStart - b.logicalStart);
    const physicalArrivalTimes = [];
    for (let i = 0; i < stopArrivalTimes.length; i++) {
      let logicalArrival = stopArrivalTimes[i];
      let addedTime = 0;

      for (const emergency of processedEmergencies) {
        if (emergency.logicalStart < logicalArrival) {
          addedTime += emergency.duration;
        }
      }

      physicalArrivalTimes.push(logicalArrival + addedTime);
    }

    if (!hasEmergencies) {
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
          const announcementTime = Math.max(0, physicalArrival - 20);
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
    }

    for (const emergency of processedEmergencies) {
      const audioPath = path.join(
        tempDir,
        `emergency_${emergency.logicalStart}.mp3`,
      );

      try {
        const emergencyType = emergency.type || "danger";
        let announcementText;

        switch (emergencyType) {
          case "danger":
            announcementText = `Emergency alert! ${emergency.text}.`;
            break;
          case "traffic":
            announcementText = `Traffic alert. ${emergency.text}. Please remain patient. Thank you.`;
            break;
          case "weather":
            announcementText = `Weather alert. ${emergency.text}. Please be cautious. Thank you.`;
            break;
          case "information":
            announcementText = `Attention passengers. ${emergency.text}. Thank you.`;
            break;
          case "announcement":
            announcementText = `Announcement. ${emergency.text}. Thank you for your attention.`;
            break;
          default:
            announcementText = `Emergency alert! ${emergency.text}.`;
        }

        await this.generateAudioAnnouncement(announcementText, audioPath);
        let addedTimeBefore = 0;
        for (const prevEmergency of processedEmergencies) {
          if (prevEmergency.logicalStart < emergency.logicalStart) {
            addedTimeBefore += prevEmergency.duration;
          }
        }

        const physicalStartTime = emergency.logicalStart + addedTimeBefore;

        emergencyAudioFiles.push({
          path: audioPath,
          startTime: physicalStartTime,
          duration: emergency.duration,
          isEmergency: true,
          emergencyType: emergency.type || "danger",
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
              `[${inputIndex}:a]volume=7.0,adelay=${delay}|${delay}[a${index}]`,
            );
            inputIndex++;
            const emergencyType = audio.emergencyType || "danger";
            let soundPath;
            let soundVolume = 0.5;

            switch (emergencyType) {
              case "danger":
                soundPath = path.join(__dirname, "../media/siren-alert.mp3");
                soundVolume = 0.5;
                break;
              case "traffic":
              case "weather":
              case "information":
              case "announcement":
                soundPath = null;
                break;
              default:
                soundPath = path.join(__dirname, "../media/siren-alert.mp3");
                soundVolume = 0.5;
            }

            if (soundPath) {
              const sirenDuration = audio.duration;
              command.input(soundPath);

              filterComplex.push(
                `[${inputIndex}:a]aloop=loop=-1:size=2e+09,atrim=0:${sirenDuration},volume=${soundVolume},adelay=${delay}|${delay}[siren${index}]`,
              );
              inputIndex++;

              filterComplex.push(
                `[a${index}][siren${index}]amix=inputs=2:duration=longest[emergency${index}]`,
              );
            } else {
              filterComplex.push(`[a${index}]anull[emergency${index}]`);
            }
          } else {
            filterComplex.push(
              `[${inputIndex}:a]volume=5.0,adelay=${delay}|${delay}[a${index}]`,
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
    emergencies = [],
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

    let emergenciesList = [];
    if (emergencies && Array.isArray(emergencies)) {
      for (const emergency of emergencies) {
        const emergencyStart = Number(emergency.startSecond) || 0;
        const emergencyDuration = Number(emergency.seconds) || 0;
        if (emergencyDuration > 0) {
          emergenciesList.push({
            logicalStart: emergencyStart,
            duration: emergencyDuration,
            text: emergency.text || "",
            type: emergency.type || "danger",
          });
        }
      }
    }
    emergenciesList.sort((a, b) => a.logicalStart - b.logicalStart);

    let timeline = [];
    let physicalTime = 0;
    let emergencyIndex = 0;

    for (const logicalPhase of logicalTimeline) {
      let phaseLogicalStart = logicalPhase.logicalStart;
      let phaseLogicalEnd = logicalPhase.logicalEnd;
      let phaseDuration = phaseLogicalEnd - phaseLogicalStart;
      let phaseElapsed = 0;
      while (emergencyIndex < emergenciesList.length) {
        const emergency = emergenciesList[emergencyIndex];

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
            startTime: physicalTime,
            endTime: physicalTime + emergency.duration,
            duration: emergency.duration,
            emergencyText: emergency.text,
            emergencyType: emergency.type || "danger",
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
    if (!isEmergency && !currentStopData) {
      const canvas = createCanvas(this.width, this.height);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = colors.background;
      ctx.fillRect(0, 0, this.width, this.height);
      return canvas.toBuffer("image/png");
    }

    ctx.fillStyle = colors.background;
    ctx.fillRect(0, 0, this.width, this.height);

    if (!isEmergency) {
      const headerHeight = 160;
      ctx.fillStyle = colors.header;
      ctx.fillRect(50, 50, this.width - 100, headerHeight);
      ctx.fillStyle = colors.accent;
      ctx.beginPath();
      ctx.moveTo(106, 70);
      ctx.lineTo(180, 70);
      ctx.lineTo(216, 130);
      ctx.lineTo(180, 190);
      ctx.lineTo(106, 190);
      ctx.lineTo(70, 130);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = colors.text;
      ctx.font = "bold 90px Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("M", 143, 130);

      ctx.fillStyle = colors.text;
      ctx.font = "bold 78px Arial";
      ctx.textAlign = "left";
      ctx.fillText(`${currentStopData.name}`, 270, 140);
      ctx.textAlign = "right";

      const currentStopLogicalStayPhases = logicalTimeline.filter(
        (p) => p.type === "stay" && p.stopIndex === currentStopIndex,
      );

      if (currentStopLogicalStayPhases.length > 0) {
        const lastLogicalStayPhase =
          currentStopLogicalStayPhases[currentStopLogicalStayPhases.length - 1];
        const logicalDepartureTime = lastLogicalStayPhase.logicalEnd;
        let elapsedLogicalTime = 0;
        for (const phase of timeline) {
          if (phase.startTime >= elapsedSeconds) break;
          if (phase.type !== "emergency") {
            const phaseElapsed =
              Math.min(phase.endTime, elapsedSeconds) - phase.startTime;
            elapsedLogicalTime += phaseElapsed;
          }
        }

        const remainingTime = Math.max(
          0,
          Math.ceil(logicalDepartureTime - elapsedLogicalTime),
        );
        if (remainingTime > 0) {
          ctx.fillStyle = colors.departure;
          ctx.font = "bold 64px Arial";
          ctx.fillText(
            `Departure in: ${this.formatTime(remainingTime)}`,
            this.width - 120,
            140,
          );
        }
      }
    }

    if (isEmergency) {
      const emergencyMessage = currentPhase.emergencyText || "EMERGENCY";
      const emergencyType = currentPhase.emergencyType || "danger";
      const emergencyY = 0;
      const emergencyHeight = this.height;
      const dangerBgColors = [
        "rgba(220, 38, 38,",
        "rgba(185, 28, 28,",
        "rgba(153, 27, 27,",
      ];

      const emergencyStyles = {
        danger: {
          bgColors: dangerBgColors,
          borderColor: "#fbbf24",
          icon: "⚠",
          iconColor: "#fbbf24",
          title: "🚨 EMERGENCY 🚨",
          titleColor: "#fbbf24",
          hasStripes: true,
          pulseSpeed: 3,
        },
        traffic: {
          bgColors: dangerBgColors,
          borderColor: "#fbbf24",
          icon: "🚗",
          iconColor: "#fbbf24",
          title: "⚠️ TRAFFIC ALERT ⚠️",
          titleColor: "#fbbf24",
          hasStripes: true,
          pulseSpeed: 3,
        },
        information: {
          bgColors: dangerBgColors,
          borderColor: "#fbbf24",
          icon: "ℹ️",
          iconColor: "#fbbf24",
          title: "📢 INFORMATION",
          titleColor: "#fbbf24",
          hasStripes: true,
          pulseSpeed: 3,
        },
        weather: {
          bgColors: dangerBgColors,
          borderColor: "#fbbf24",
          icon: "🌧️",
          iconColor: "#fbbf24",
          title: "⛈️ WEATHER ALERT ⛈️",
          titleColor: "#fbbf24",
          hasStripes: true,
          pulseSpeed: 3,
        },
        announcement: {
          bgColors: dangerBgColors,
          borderColor: "#fbbf24",
          icon: "📢",
          iconColor: "#fbbf24",
          title: "📢 ANNOUNCEMENT",
          titleColor: "#fbbf24",
          hasStripes: true,
          pulseSpeed: 3,
        },
      };

      const style = emergencyStyles[emergencyType] || emergencyStyles.danger;
      const pulseIntensity =
        Math.abs(Math.sin(elapsedSeconds * style.pulseSpeed)) * 0.3 + 0.7;

      const gradient = ctx.createLinearGradient(
        0,
        emergencyY,
        0,
        emergencyY + emergencyHeight,
      );
      gradient.addColorStop(0, `${style.bgColors[0]} ${pulseIntensity})`);
      gradient.addColorStop(0.5, `${style.bgColors[1]} ${pulseIntensity})`);
      gradient.addColorStop(1, `${style.bgColors[2]} ${pulseIntensity})`);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, emergencyY, this.width, emergencyHeight);
      if (style.hasStripes) {
        ctx.strokeStyle = style.borderColor;
        ctx.lineWidth = 12;
        const stripeOffset = (elapsedSeconds * 100) % 100;
        for (let i = -5; i < 30; i++) {
          const x = i * 100 - stripeOffset;
          ctx.beginPath();
          ctx.moveTo(x, emergencyY);
          ctx.lineTo(x + emergencyHeight, emergencyY + emergencyHeight);
          ctx.stroke();
        }
      }

      const flashIntensity =
        Math.abs(Math.sin(elapsedSeconds * 4)) > 0.5 ? 1 : 0.4;
      const hexToRgba = (hex, alpha) => {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
      };

      ctx.strokeStyle = hexToRgba(style.borderColor, flashIntensity);
      ctx.lineWidth = 15;
      ctx.strokeRect(
        20,
        emergencyY + 20,
        this.width - 40,
        emergencyHeight - 40,
      );

      ctx.strokeStyle = `rgba(255, 255, 255, ${flashIntensity * 0.5})`;
      ctx.lineWidth = 8;
      ctx.strokeRect(
        35,
        emergencyY + 35,
        this.width - 70,
        emergencyHeight - 70,
      );

      const iconSize = 140 + Math.sin(elapsedSeconds * 5) * 30;
      ctx.fillStyle = style.iconColor;
      ctx.font = `bold ${iconSize}px Arial`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      ctx.shadowColor = hexToRgba(style.iconColor, 0.8);
      ctx.shadowBlur = 30;
      ctx.fillText(style.icon, this.width / 2, emergencyY + 200);

      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 96px Arial";
      ctx.shadowColor = "rgba(0, 0, 0, 0.9)";
      ctx.shadowBlur = 15;
      ctx.shadowOffsetX = 4;
      ctx.shadowOffsetY = 4;

      const maxWidth = this.width - 200;
      const words = emergencyMessage.split(" ");
      let line = "";
      let y = emergencyY + 380;
      const lineHeight = 110;

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
      ctx.fillStyle = style.titleColor;
      ctx.font = "bold 64px Arial";
      ctx.fillText(style.title, this.width / 2, emergencyY + 220);
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
      const startY = 280;
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
        if (visibleStopsCount > 1) {
          ctx.fillStyle = colors.accent;
          ctx.beginPath();
          ctx.moveTo(lineX, bottomY + 40);
          ctx.lineTo(lineX - 25, bottomY - 10);
          ctx.lineTo(lineX + 25, bottomY - 10);
          ctx.closePath();
          ctx.fill();
        }
      }

      ctx.textAlign = "left";
      for (let i = 0; i < visibleStopsCount; i++) {
        const actualIndex = nextStopStartIndex + i;
        const y = visibleStopsCount === 1 ? startY : startY + i * stopSpacing;
        let logicalArrivalTime = 0;
        const logicalTravelPhasesToStop = logicalTimeline.filter(
          (p) => p.type === "travel" && p.nextStopIndex === actualIndex,
        );

        if (logicalTravelPhasesToStop.length > 0) {
          const lastLogicalTravelPhase =
            logicalTravelPhasesToStop[logicalTravelPhasesToStop.length - 1];
          logicalArrivalTime = lastLogicalTravelPhase.logicalEnd;
        } else {
          const firstLogicalStayAtStop = logicalTimeline.find(
            (p) => p.type === "stay" && p.stopIndex === actualIndex,
          );
          if (firstLogicalStayAtStop) {
            logicalArrivalTime = firstLogicalStayAtStop.logicalStart;
          }
        }
        let elapsedLogicalTime = 0;
        for (const phase of timeline) {
          if (phase.startTime >= elapsedSeconds) break;
          if (phase.type !== "emergency") {
            const phaseElapsed =
              Math.min(phase.endTime, elapsedSeconds) - phase.startTime;
            elapsedLogicalTime += phaseElapsed;
          }
        }

        let remainingTime = Math.max(
          0,
          logicalArrivalTime - elapsedLogicalTime,
        );

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
        ctx.font = i === 0 ? "bold 94px Arial" : "94px Arial";
        ctx.fillText(visibleStops[i].name, 270, y + 20);
        ctx.fillStyle = colors.text;
        ctx.font = "94px Arial";
        ctx.textAlign = "right";
        const seconds = Math.max(0, Math.ceil(remainingTime));
        ctx.fillText(this.formatTime(seconds), this.width - 120, y + 20);
        ctx.textAlign = "left";
      }
    }

    if (!isEmergency) {
      const bottomBarHeight = 180;
      const bottomMargin = 50;
      const bottomBarY = this.height - bottomBarHeight - bottomMargin;
      ctx.fillStyle = colors.footer;
      ctx.fillRect(50, bottomBarY, this.width - 100, bottomBarHeight);

      ctx.fillStyle = colors.text;
      ctx.font = "bold 84px Arial";
      ctx.textAlign = "left";
      const finalStopName = stops[stops.length - 1].name;
      ctx.fillText(finalStopName, 120, bottomBarY + 95);
      const lastStopIndex = stops.length - 1;
      let logicalArrivalTimeAtFinalStop = 0;
      const logicalTravelPhasesToLastStop = logicalTimeline.filter(
        (p) => p.type === "travel" && p.nextStopIndex === lastStopIndex,
      );

      if (logicalTravelPhasesToLastStop.length > 0) {
        const lastLogicalTravelPhase =
          logicalTravelPhasesToLastStop[
            logicalTravelPhasesToLastStop.length - 1
          ];
        logicalArrivalTimeAtFinalStop = lastLogicalTravelPhase.logicalEnd;
      } else {
        const firstLogicalStayAtLastStop = logicalTimeline.find(
          (p) => p.type === "stay" && p.stopIndex === lastStopIndex,
        );
        if (firstLogicalStayAtLastStop) {
          logicalArrivalTimeAtFinalStop =
            firstLogicalStayAtLastStop.logicalStart;
        } else {
          logicalArrivalTimeAtFinalStop =
            logicalTimeline.length > 0
              ? logicalTimeline[logicalTimeline.length - 1].logicalEnd
              : 0;
        }
      }
      let elapsedLogicalTime = 0;
      for (const phase of timeline) {
        if (phase.startTime >= elapsedSeconds) break;
        if (phase.type !== "emergency") {
          const phaseElapsed =
            Math.min(phase.endTime, elapsedSeconds) - phase.startTime;
          elapsedLogicalTime += phaseElapsed;
        }
      }

      const remainingTimeToFinalStop = Math.max(
        0,
        logicalArrivalTimeAtFinalStop - elapsedLogicalTime,
      );
      const remainingSecondsToFinalStop = Math.ceil(remainingTimeToFinalStop);

      ctx.font = "bold 84px Arial";
      ctx.textAlign = "right";
      ctx.fillText(
        this.formatTime(remainingSecondsToFinalStop),
        this.width - 120,
        bottomBarY + 95,
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
        const emergencies = scenario.emergencies || [];
        const emergencyDuration = emergencies.reduce(
          (sum, e) => sum + (Number(e.seconds) || 0),
          0,
        );
        totalDuration += emergencyDuration;
        break;
      }

      const totalFrames = totalDuration * this.fps;
      const audioFiles = await this.createAudioTimeline(
        stops,
        scenario.emergencies || [],
        tempDir,
      );
      for (let frame = 0; frame < totalFrames; frame++) {
        const elapsedSeconds = frame / this.fps;

        const frameBuffer = await this.generateStopFrame(
          0,
          stops.length,
          stops,
          routeName,
          elapsedSeconds,
          scenario.theme || "dark",
          scenario.emergencies || [],
        );

        const framePath = path.join(
          tempDir,
          `frame_${String(frameIndex).padStart(6, "0")}.png`,
        );
        await fsPromises.writeFile(framePath, frameBuffer);
        frameIndex++;
        if (frame % 10 === 0) {
          await new Promise((resolve) => setImmediate(resolve));
        }
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
        await fsPromises.copyFile(videoOnlyPath, outputPath);
      }

      await fsPromises.rm(tempDir, { recursive: true, force: true });
      console.log("Video generation complete!");
      return outputPath;
    } catch (error) {
      console.error("Error in generateVideo:", error);
      try {
        await fsPromises.rm(tempDir, { recursive: true, force: true });
      } catch (cleanupError) {
        console.error("Error cleaning up temp directory:", cleanupError);
      }
      throw error;
    }
  }
}

module.exports = new VideoGenerator();

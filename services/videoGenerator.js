const { createCanvas } = require('canvas');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');

class VideoGenerator {
  constructor() {
    this.width = 1920;
    this.height = 1080;
    this.fps = 10;
  }

  async generateStopFrame(currentStop, totalStops, stops, routeName, elapsedSeconds) {
    const canvas = createCanvas(this.width, this.height);
    const ctx = canvas.getContext('2d');

    // Calculate cumulative times
    let cumulativeTimes = [0];
    for (let i = 0; i < stops.length; i++) {
      cumulativeTimes.push(cumulativeTimes[i] + stops[i].durationSeconds);
    }

    // Find current stop index based on elapsed time
    let activeStopIndex = 0;
    for (let i = 0; i < cumulativeTimes.length - 1; i++) {
      if (elapsedSeconds >= cumulativeTimes[i] && elapsedSeconds < cumulativeTimes[i + 1]) {
        activeStopIndex = i;
        break;
      }
    }

    // Background - Dark gray
    ctx.fillStyle = '#3c3c3c';
    ctx.fillRect(0, 0, this.width, this.height);

    // Header bar - Gray
      ctx.fillStyle = '#7a7a7a';
    ctx.fillRect(34, 34, this.width - 68, 88);

    // Route indicator - Orange hexagon background
    ctx.fillStyle = '#ff8800';
    ctx.beginPath();
    ctx.moveTo(90, 50);
    ctx.lineTo(150, 50);
    ctx.lineTo(180, 78);
    ctx.lineTo(150, 106);
    ctx.lineTo(90, 106);
    ctx.lineTo(60, 78);
    ctx.closePath();
    ctx.fill();

    // Route letter "E"
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 60px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('E', 120, 78);

    // Route name
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 48px Arial';
    ctx.textAlign = 'left';
    ctx.fillText(`TU-Ilmenau | ${stops[stops.length - 1].name}`, 235, 78);

   const visibleStops = stops.slice(activeStopIndex, activeStopIndex + 3);
    const visibleStopsCount = visibleStops.length;

    // Draw timeline line - Orange
    const lineX = 120;
    const startY = 180;
     const bottomY = this.height - 350; // Leave space for bottom bar
    const stopSpacing = visibleStopsCount > 1 ? (bottomY - startY) / (visibleStopsCount - 1) : 0;
    
    ctx.strokeStyle = '#ff8800';
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.moveTo(lineX, startY);
    ctx.lineTo(lineX, bottomY);
    ctx.stroke();

    // Draw stops
    ctx.textAlign = 'left';
    for (let i = 0; i < visibleStopsCount; i++) {
      const actualIndex = activeStopIndex + i;
      const y = startY + i * stopSpacing;
      
      // Calculate remaining time for this stop
      let remainingTime = cumulativeTimes[actualIndex + 1] - elapsedSeconds;
      
      // Stop circle
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(lineX, y, 20, 0, Math.PI * 2);
      ctx.fill();
      
      // Orange border for current stop (first visible stop)
      if (i === 0) {
        ctx.strokeStyle = '#ff8800';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(lineX, y, 24, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Stop name
      ctx.fillStyle = '#ffffff';
      ctx.font = i === 0 ? 'bold 56px Arial' : '56px Arial';
      ctx.fillText(visibleStops[i].name, 235, y + 15);

      // Time display
      ctx.fillStyle = '#ffffff';
      ctx.font = '56px Arial';
      ctx.textAlign = 'right';
      
      // Show minutes for all visible stops
         const minutes = Math.ceil(remainingTime / 60);
      ctx.fillText(`${minutes} Min.`, this.width - 100, y + 15);
      ctx.textAlign = 'left';
    }

    // Bottom bar - Gray
    const bottomBarY = this.height - 600;
    ctx.fillStyle = '#7a7a7a';
    ctx.fillRect(34, bottomBarY, this.width - 410, 116);

    // "Next stop:"
    ctx.fillStyle = '#ffffff';
    ctx.font = '36px Arial';
    ctx.fillText('Next stop:', 235, bottomBarY + 40);

    // Next stop name
    ctx.font = 'bold 60px Arial';
    const nextStopIndex = activeStopIndex < totalStops - 1 ? activeStopIndex + 1 : activeStopIndex;
    const nextStopName = stops[nextStopIndex].name;
    ctx.fillText(nextStopName, 235, bottomBarY + 90);

    // STOP button - Orange
      const stopBtnX = this.width - 342;
    ctx.fillStyle = '#ff8800';
    ctx.fillRect(stopBtnX, bottomBarY, 308, 116);
    
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 72px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('STOP', stopBtnX + 154, bottomBarY + 75);

    return canvas.toBuffer('image/png');
  }

  async generateVideo(scenario, outputPath) {
    const tempDir = path.join(__dirname, '../temp', `scenario_${Date.now()}`);
    
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    try {
      let frameIndex = 0;
      const stops = scenario.stops;
      console.log('Stops:', stops);
      const routeName = (scenario.stops && scenario.stops.length > 0) ? scenario.stops[scenario.stops.length - 1].name : 'Gustav-Kirchhoff-Platz';
console.log('Route Name:', routeName);
      // Calculate total duration
      const totalDuration = stops.reduce((sum, stop) => sum + stop.durationSeconds, 0);
      const totalFrames = totalDuration * this.fps;

      // Generate all frames
      for (let frame = 0; frame < totalFrames; frame++) {
        const elapsedSeconds = frame / this.fps;
        
        const frameBuffer = await this.generateStopFrame(
          0, // currentStop is calculated inside
          stops.length,
          stops,
          routeName,
          elapsedSeconds
        );

        const framePath = path.join(tempDir, `frame_${String(frameIndex).padStart(6, '0')}.png`);
        fs.writeFileSync(framePath, frameBuffer);
        frameIndex++;
      }

      // Generate video from frames
      return new Promise((resolve, reject) => {
        ffmpeg()
          .input(path.join(tempDir, 'frame_%06d.png'))
          .inputFPS(this.fps)
          .videoCodec('libx264')
          .outputOptions([
            '-pix_fmt yuv420p',
            '-preset ultrafast', // Faster encoding
            '-crf 23' // Good quality/size balance
          ])
          .output(outputPath)
          .on('end', () => {
            // Cleanup temp files
            fs.rmSync(tempDir, { recursive: true, force: true });
            resolve(outputPath);
          })
          .on('error', (err) => {
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
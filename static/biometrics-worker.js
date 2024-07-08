importScripts('/opencv.js'); 

const LOW_BPM = 42;
const HIGH_BPM = 240;
const SEC_PER_MIN = 60;
const LOW_BRPM = 5;
const HIGH_BRPM = 25;

self.onmessage = function (e) {
  const { signal, timestamps, fps, hrWindowSize, brWindowSize, rescan, movementHistory, callbackData } = e.data;

  function denoise(signal, rescan) {
    let diff = new cv.Mat();
    cv.subtract(signal.rowRange(1, signal.rows), signal.rowRange(0, signal.rows - 1), diff);
    for (let i = 1; i < signal.rows; i++) {
      if (rescan[i] === true) {
        let adjV = new cv.MatVector();
        let adjR = cv.matFromArray(signal.rows, 1, cv.CV_32FC1, new Array(signal.rows).fill(0).fill(diff.data32F[(i - 1) * 3], i, signal.rows));
        let adjG = cv.matFromArray(signal.rows, 1, cv.CV_32FC1, new Array(signal.rows).fill(0).fill(diff.data32F[(i - 1) * 3 + 1], i, signal.rows));
        let adjB = cv.matFromArray(signal.rows, 1, cv.CV_32FC1, new Array(signal.rows).fill(0).fill(diff.data32F[(i - 1) * 3 + 2], i, signal.rows));
        adjV.push_back(adjR);
        adjV.push_back(adjG);
        adjV.push_back(adjB);
        let adj = new cv.Mat();
        cv.merge(adjV, adj);
        cv.subtract(signal, adj, signal);
        adjV.delete();
        adjR.delete();
        adjG.delete();
        adjB.delete();
        adj.delete();
      }
    }
    diff.delete();
  }

  function standardize(signal) {
    let mean = new cv.Mat();
    let stdDev = new cv.Mat();
    let t1 = new cv.Mat();
    cv.meanStdDev(signal, mean, stdDev, t1);
    let means_c3 = cv.matFromArray(1, 1, cv.CV_32FC3, [mean.data64F[0], mean.data64F[1], mean.data64F[2]]);
    let stdDev_c3 = cv.matFromArray(1, 1, cv.CV_32FC3, [stdDev.data64F[0], stdDev.data64F[1], stdDev.data64F[2]]);
    let means = new cv.Mat(signal.rows, 1, cv.CV_32FC3);
    let stdDevs = new cv.Mat(signal.rows, 1, cv.CV_32FC3);
    cv.repeat(means_c3, signal.rows, 1, means);
    cv.repeat(stdDev_c3, signal.rows, 1, stdDevs);
    cv.subtract(signal, means, signal, t1, -1);
    cv.divide(signal, stdDevs, signal, 1, -1);
    mean.delete();
    stdDev.delete();
    t1.delete();
    means_c3.delete();
    stdDev_c3.delete();
    means.delete();
    stdDevs.delete();
  }

  function detrend(signal, lambda) {
    let h = cv.Mat.zeros(signal.rows - 2, signal.rows, cv.CV_32FC1);
    let i = cv.Mat.eye(signal.rows, signal.rows, cv.CV_32FC1);
    let t1 = cv.Mat.ones(signal.rows - 2, 1, cv.CV_32FC1);
    let t2 = cv.matFromArray(signal.rows - 2, 1, cv.CV_32FC1, new Array(signal.rows - 2).fill(-2));
    let t3 = new cv.Mat();
    t1.copyTo(h.diag(0));
    t2.copyTo(h.diag(1));
    t1.copyTo(h.diag(2));
    cv.gemm(h, h, lambda * lambda, t3, 0, h, cv.GEMM_1_T);
    cv.add(i, h, h, t3, -1);
    cv.invert(h, h, cv.DECOMP_LU);
    cv.subtract(i, h, h, t3, -1);
    let s = new cv.MatVector();
    cv.split(signal, s);
    cv.gemm(h, s.get(0), 1, t3, 0, s.get(0), 0);
    cv.gemm(h, s.get(1), 1, t3, 0, s.get(1), 0);
    cv.gemm(h, s.get(2), 1, t3, 0, s.get(2), 0);
    cv.merge(s, signal);
    h.delete();
    i.delete();
    t1.delete();
    t2.delete();
    t3.delete();
    s.delete();
  }

  function movingAverage(signal, n, kernelSize) {
    let kernel = new Array(kernelSize).fill(1 / kernelSize);

    for (let i = 0; i < n; i++) {
      let smoothedSignal = new cv.Mat(signal.rows, 1, cv.CV_32FC1);

      for (let j = 0; j < signal.rows; j++) {
        let sum = 0;
        for (let k = 0; k < kernelSize; k++) {
          if (j - k >= 0) {
            sum += signal.data32F[j - k] * kernel[k];
          }
        }
        smoothedSignal.data32F[j] = sum;
      }

      signal = smoothedSignal.clone();
      smoothedSignal.delete();
    }
  }

  function selectGreen(signal) {
    let rgb = new cv.MatVector();
    cv.split(signal, rgb);
    let result = rgb.get(1);
    rgb.delete();
    return result;
  }

  function selectRed(signal) {
    let rgb = new cv.MatVector();
    cv.split(signal, rgb);
    let result = rgb.get(2);
    rgb.delete();
    return result;
  }

  function butterworthBandPassFilter(signal, lowCutoff = 0.2, highCutoff = 0.8, fps) {
    let nyquist = 0.5 * fps;
    let lowNormalizedCutoff = lowCutoff / nyquist;
    let highNormalizedCutoff = highCutoff / nyquist;

    let thetaLow = Math.PI * lowNormalizedCutoff;
    let thetaHigh = Math.PI * highNormalizedCutoff;
    let bandwidth = thetaHigh - thetaLow;
    let centerFrequency = Math.sqrt(thetaLow * thetaHigh);

    let d = Math.cos(centerFrequency) / Math.sin(centerFrequency);
    let beta = 0.5 * ((1 - d) / (1 + d));
    let gamma = (0.5 + beta) * Math.cos(centerFrequency);
    let alpha = (0.5 + beta - gamma) / 2;

    let b = [alpha, 0, -alpha];
    let a = [1, -2 * gamma, 2 * beta];

    let filteredSignal = new cv.Mat(signal.rows, 1, cv.CV_32FC1);
    let z = [0, 0];

    for (let i = 0; i < signal.rows; i++) {
      let x = signal.data32F[i];
      let y = b[0] * x + z[0];
      z[0] = b[1] * x + z[1] - a[1] * y;
      z[1] = b[2] * x - a[2] * y;
      filteredSignal.data32F[i] = y;
    }

    return filteredSignal;
  }

  function timeToFrequency(signal, magnitude) {
    let planes = new cv.MatVector();
    planes.push_back(signal);
    planes.push_back(cv.Mat.zeros(signal.rows, 1, cv.CV_32F));
    cv.merge(planes, signal);
    cv.dft(signal, signal, cv.DFT_COMPLEX_OUTPUT);
    if (magnitude) {
      cv.split(signal, planes);
      cv.magnitude(planes.get(0), planes.get(1), signal);
    }
  }

  function estimateRate(channel, lowLimit, highLimit, fps) {
    let lowIndex = Math.floor(channel.rows * lowLimit / SEC_PER_MIN / fps);
    let highIndex = Math.ceil(channel.rows * highLimit / SEC_PER_MIN / fps);
    let bandMask = cv.matFromArray(channel.rows, 1, cv.CV_8U, new Array(channel.rows).fill(0).fill(1, lowIndex, highIndex + 1));
    let result = cv.minMaxLoc(channel, bandMask);
    bandMask.delete();
    return result.maxLoc.y * fps / channel.rows * SEC_PER_MIN;
  }

  function calculateMovementScore(movementHistory, duration) {
    if (movementHistory.length === 0) return 0;
  
    const recentHistory = movementHistory.filter(m => m.timestamp > Date.now() - duration);
    
    if (recentHistory.length === 0) return 0;
  
    const avgMovement = recentHistory.reduce((sum, m) => sum + m.movement, 0) / recentHistory.length;
    
    // The movement is already normalized to 0-100 scale, so we can return it directly
    return avgMovement;
  }

  // Calculate movement over the last 5 seconds
  let movement = calculateMovementScore(movementHistory, 5000);

  // Heart rate calculation
  let hrWindowFrames = fps * hrWindowSize;
  let hrSignal = signal.slice(-hrWindowFrames);
  let hrMat = cv.matFromArray(hrSignal.length, 1, cv.CV_32FC3, [].concat.apply([], hrSignal));

  denoise(hrMat, rescan);
  standardize(hrMat);
  detrend(hrMat, fps);
  movingAverage(hrMat, 3, Math.max(Math.floor(fps / 6), 2));

  let greenChannel = selectGreen(hrMat);
  timeToFrequency(greenChannel, true);
  let bpm = estimateRate(greenChannel, LOW_BPM, HIGH_BPM, fps);

  greenChannel.delete();
  hrMat.delete();

  // Breathing rate calculation
  let brWindowFrames = fps * brWindowSize;
  let brSignal = signal.slice(-brWindowFrames);
  let brMat = cv.matFromArray(brSignal.length, 1, cv.CV_32FC3, [].concat.apply([], brSignal));

  denoise(brMat, rescan);
  standardize(brMat);
  detrend(brMat, fps);
  movingAverage(brMat, 3, Math.max(Math.floor(fps / 6), 2));

  let redChannel = selectRed(brMat);
  let breathingSignal = butterworthBandPassFilter(redChannel, 0.1, 0.4, fps);
  timeToFrequency(breathingSignal, true);
  let brpm = estimateRate(breathingSignal, LOW_BRPM, HIGH_BRPM, fps);

  redChannel.delete();
  breathingSignal.delete();
  brMat.delete();

  self.postMessage({
    bpm: parseFloat(bpm.toFixed(0)),
    brpm: parseFloat(brpm.toFixed(0)),
    movement: parseFloat(movement.toFixed(0)),
    timestamp: callbackData.timestamp
  });
};
// @ts-nocheck

const RESCAN_INTERVAL = 1000;
const DEFAULT_FPS = 30;
const MSEC_PER_SEC = 1000;
const MAX_CORNERS = 10;
const MIN_CORNERS = 5;
const QUALITY_LEVEL = 0.01;
const MIN_DISTANCE = 10;

// Simple rPPG implementation in JavaScript
// - Code could be improved given better documentation available for opencv.js
export class Biometrics {
  constructor(webcamId, canvasId, classifierPath, targetFps, hrWindowSize, brWindowSize, rppgInterval, callback) {
    this.webcamId = webcamId;
    this.canvasId = canvasId;
    this.classifierPath = classifierPath;
    this.streaming = false;
    this.faceValid = false;
    this.targetFps = targetFps;
    this.hrWindowSize = hrWindowSize; 
    this.brWindowSize = brWindowSize;
    this.rppgInterval = rppgInterval;
    this.callback = callback;

    this.backSub = new cv.BackgroundSubtractorMOG2(500, 16, false); // Set detectShadows to false
    this.fgMask = new cv.Mat();
    this.movementHistory = [];
    this.maxMovementHistory = 30;
    this.movementThreshold = 0.01; // Adjust this value as needed
    this.lastMovementScore = 0;
    this.movementAlpha = 0.5; // Exponential moving average factor

    this.worker = new Worker('/biometrics-worker.js');
    this.worker.onmessage = (e) => {
      if (this.callback) {
        this.callback(e.data);
      }
    };
  }

  // Start the video stream
  async startStreaming() {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { exact: this.webcamVideoElement.width },
          height: { exact: this.webcamVideoElement.height }
        },
        audio: false
      });
    } catch (e) {
      console.log(e);
    }
    if (!this.stream) {
      throw new Error('Could not obtain video from webcam.');
    }
    // Set srcObject to the obtained stream
    this.webcamVideoElement.srcObject = this.stream;
    // Start the webcam video stream
    this.webcamVideoElement.play();
    this.streaming = true;
    return new Promise(resolve => {
      // Add event listener to make sure the webcam has been fully initialized.
      this.webcamVideoElement.oncanplay = () => {
        resolve();
      };
    });
  }

  // Create file from url
  async createFileFromUrl(path, url) {
    let request = new XMLHttpRequest();
    request.open('GET', url, true);
    request.responseType = 'arraybuffer';
    request.send();
    return new Promise(resolve => {
      request.onload = () => {
        if (request.readyState === 4) {
          if (request.status === 200) {
            let data = new Uint8Array(request.response);
            cv.FS_createDataFile('/', path, data, true, false, false);
            resolve();
          } else {
            console.log('Failed to load ' + url + ' status: ' + request.status);
          }
        }
      };
    });
  }

  // Initialise the demo
  async init() {
    this.webcamVideoElement = document.getElementById(this.webcamId);
    try {
      await this.startStreaming();
      this.webcamVideoElement.width = this.webcamVideoElement.videoWidth;
      this.webcamVideoElement.height = this.webcamVideoElement.videoHeight;
      this.frameRGB = new cv.Mat(this.webcamVideoElement.height, this.webcamVideoElement.width, cv.CV_8UC4);
      this.lastFrameGray = new cv.Mat(this.webcamVideoElement.height, this.webcamVideoElement.width, cv.CV_8UC1);
      this.frameGray = new cv.Mat(this.webcamVideoElement.height, this.webcamVideoElement.width, cv.CV_8UC1);
      this.overlayMask = new cv.Mat(this.webcamVideoElement.height, this.webcamVideoElement.width, cv.CV_8UC1);
      this.cap = new cv.VideoCapture(this.webcamVideoElement);
      // Set variables
      this.signal = []; // 120 x 3 raw rgb values
      this.timestamps = []; // 120 x 1 timestamps
      this.rescan = []; // 120 x 1 rescan bool
      this.face = new cv.Rect();  // Position of the face
      // Load face detector
      this.classifier = new cv.CascadeClassifier();
      let faceCascadeFile = "haarcascade_frontalface_alt.xml";
      if (!this.classifier.load(faceCascadeFile)) {
        await this.createFileFromUrl(faceCascadeFile, this.classifierPath);
        this.classifier.load(faceCascadeFile)
      }
      this.scanTimer = setInterval(this.processFrame.bind(this),
        MSEC_PER_SEC / this.targetFps);
      this.rppgTimer = setInterval(this.rppg.bind(this), this.rppgInterval);
    } catch (e) {
      console.log(e);
    }
  }

  // Add one frame to raw signal
  processFrame() {
    try {
      if (!this.frameGray.empty()) {
        this.frameGray.copyTo(this.lastFrameGray); // Save last frame
      }
      this.cap.read(this.frameRGB); // Save current frame
      let time = Date.now();
      let rescanFlag = false;
      cv.cvtColor(this.frameRGB, this.frameGray, cv.COLOR_RGBA2GRAY);

      // Apply background subtraction
      this.backSub.apply(this.frameGray, this.fgMask);
      let movement = cv.countNonZero(this.fgMask) / (this.fgMask.rows * this.fgMask.cols);
      
      // Apply threshold and smooth the movement score
      if (movement > this.movementThreshold) {
        this.lastMovementScore = this.movementAlpha * movement + (1 - this.movementAlpha) * this.lastMovementScore;
      } else {
        this.lastMovementScore = (1 - this.movementAlpha) * this.lastMovementScore;
      }
      
      // Normalize to 0-100 scale
      let normalizedMovement = Math.min(100, this.lastMovementScore * 1000);
      
      // Store movement in history
      this.movementHistory.push({movement: normalizedMovement, timestamp: time});
      if (this.movementHistory.length > this.maxMovementHistory) {
        this.movementHistory.shift();
      }

      // Need to find the face
      if (!this.faceValid) {
        this.lastScanTime = time;
        this.detectFace(this.frameGray);
      }
      // Scheduled face rescan
      else if (time - this.lastScanTime >= RESCAN_INTERVAL) {
        this.lastScanTime = time;
        this.detectFace(this.frameGray);
        rescanFlag = true;
      }
      // Track face
      else {
        // Uncomment if you want to use face tracking
        this.trackFace(this.lastFrameGray, this.frameGray);
      }

      // Update last frame
      this.frameGray.copyTo(this.lastFrameGray);

      // Update the signal
      if (this.faceValid) {
        // Get mask
        let mask = this.makeMask(this.frameGray, this.face);

        // New values
        let means = cv.mean(this.frameRGB, mask);
        mask.delete();

        // Add new values to raw signal buffer
        this.signal.push(means.slice(0, 3));
        this.timestamps.push(time);
        this.rescan.push(rescanFlag);

        // Remove old data if buffer is too large
        let maxBufferSize = this.targetFps * this.hrWindowSize * 2;
        while (this.signal.length > maxBufferSize) {
          this.signal.shift();
          this.timestamps.shift();
          this.rescan.shift();
        }
      }

      // Draw face
      cv.rectangle(this.frameRGB, new cv.Point(this.face.x, this.face.y),
        new cv.Point(this.face.x + this.face.width, this.face.y + this.face.height),
        [0, 255, 0, 255]);

      // Apply overlayMask
      this.frameRGB.setTo([255, 0, 0, 255], this.overlayMask);
      cv.imshow(this.canvasId, this.frameRGB);
    } catch (e) {
      console.log("Error capturing frame:");
      console.log(e);
    }
  }

  // Run face classifier
  detectFace(gray) {
    let faces = new cv.RectVector();
    this.classifier.detectMultiScale(gray, faces, 1.1, 3, 0);
    if (faces.size() > 0) {
      this.face = faces.get(0);
      this.faceValid = true;
    } else {
      console.log("No faces");
      this.invalidateFace();
    }
    faces.delete();
  }

  // Make ROI mask from face
  makeMask(frameGray, face) {
    let result = cv.Mat.zeros(frameGray.rows, frameGray.cols, cv.CV_8UC1);
    let white = new cv.Scalar(255, 255, 255, 255);
    let pt1 = new cv.Point(Math.round(face.x + 0.3 * face.width),
      Math.round(face.y + 0.1 * face.height));
    let pt2 = new cv.Point(Math.round(face.x + 0.7 * face.width),
      Math.round(face.y + 0.25 * face.height));
    cv.rectangle(result, pt1, pt2, white, -1);
    return result;
  }

  // Invalidate the face
  invalidateFace() {
    this.signal = [];
    this.timestamps = [];
    this.rescan = [];
    this.overlayMask.setTo([0, 0, 0, 0]);
    this.face = new cv.Rect();
    this.faceValid = false;
    this.corners = [];
  }

  // Track the face
  trackFace(lastFrameGray, frameGray) {
    // If not available, detect some good corners to track within face
    let trackingMask = cv.Mat.zeros(frameGray.rows, frameGray.cols, cv.CV_8UC1);
    let squarePointData = new Uint8Array([
      this.face.x + 0.22 * this.face.width, this.face.y + 0.21 * this.face.height,
      this.face.x + 0.78 * this.face.width, this.face.y + 0.21 * this.face.height,
      this.face.x + 0.70 * this.face.width, this.face.y + 0.65 * this.face.height,
      this.face.x + 0.30 * this.face.width, this.face.y + 0.65 * this.face.height]);
      let squarePoints = cv.matFromArray(4, 1, cv.CV_32SC2, squarePointData);
      let pts = new cv.MatVector();
      let corners = new cv.Mat();
      pts.push_back(squarePoints);
      cv.fillPoly(trackingMask, pts, [255, 255, 255, 255]);
      cv.goodFeaturesToTrack(lastFrameGray, corners, MAX_CORNERS,
        QUALITY_LEVEL, MIN_DISTANCE, trackingMask, 3);
      trackingMask.delete();
      squarePoints.delete();
      pts.delete();
  
      // Calculate optical flow
      let corners_1 = new cv.Mat();
      let st = new cv.Mat();
      let err = new cv.Mat();
      let winSize = new cv.Size(15, 15);
      let maxLevel = 2;
      let criteria = new cv.TermCriteria(
        cv.TERM_CRITERIA_EPS | cv.TERM_CRITERIA_COUNT, 10, 0.03);
      cv.calcOpticalFlowPyrLK(lastFrameGray, frameGray, corners, corners_1,
        st, err, winSize, maxLevel, criteria);
  
      // Backtrack once
      let corners_0 = new cv.Mat();
      cv.calcOpticalFlowPyrLK(frameGray, lastFrameGray, corners_1, corners_0,
        st, err, winSize, maxLevel, criteria);
      // TODO exclude unmatched corners
  
      // Clean up
      st.delete();
      err.delete();
  
      if (corners_1.rows >= MIN_CORNERS) {
        // Estimate affine transform
        const [s, tx, ty] = this.estimateAffineTransform(corners_0, corners_1);
        // Apply affine transform
        this.face = new cv.Rect(
          this.face.x * s + tx, this.face.y * s + ty,
          this.face.width * s, this.face.height * s);
      } else {
        this.invalidateFace();
      }
  
      corners.delete();
      corners_1.delete();
      corners_0.delete();
    }
  
    // For some reason this is not available in opencv.js, so implemented it
    estimateAffineTransform(corners_0, corners_1) {
      // Construct X and Y matrix
      let t_x = cv.matFromArray(corners_0.rows * 2, 1, cv.CV_32FC1,
        Array.from(corners_0.data32F));
      let y = cv.matFromArray(corners_1.rows * 2, 1, cv.CV_32FC1,
        Array.from(corners_1.data32F));
      let x = new cv.Mat(corners_0.rows * 2, 3, cv.CV_32FC1);
      let t_10 = new cv.Mat();
      let t_01 = new cv.Mat();
      cv.repeat(cv.matFromArray(2, 1, cv.CV_32FC1, [1, 0]), corners_0.rows, 1, t_10);
      cv.repeat(cv.matFromArray(2, 1, cv.CV_32FC1, [0, 1]), corners_0.rows, 1, t_01);
      t_x.copyTo(x.col(0));
      t_10.copyTo(x.col(1));
      t_01.copyTo(x.col(2));
  
      // Solve
      let res = cv.Mat.zeros(3, 1, cv.CV_32FC1);
      cv.solve(x, y, res, cv.DECOMP_SVD);
  
      // Clean up
      t_01.delete();
      t_10.delete();
      x.delete();
      t_x.delete();
      y.delete();
  
      return [res.data32F[0], res.data32F[1], res.data32F[2]];
    }
  
    // Compute rppg signal and estimate HR and BR
    rppg() {
      let fps = this.getFps(this.timestamps);
  
      if (this.signal.length >= fps) {
        this.worker.postMessage({
          signal: this.signal,
          timestamps: this.timestamps,
          fps: fps,
          hrWindowSize: this.hrWindowSize,
          brWindowSize: this.brWindowSize,
          rescan: this.rescan,
          movementHistory: this.movementHistory,
          callbackData: { timestamp: this.timestamps[this.timestamps.length - 1] }
        });
      }
    }
  
    // Calculate fps from timestamps
    getFps(timestamps, timeBase = 1000) {
      if (Array.isArray(timestamps) && timestamps.length) {
        if (timestamps.length === 1) {
          return DEFAULT_FPS;
        } else {
          let diff = timestamps[timestamps.length - 1] - timestamps[0];
          return timestamps.length / diff * timeBase;
        }
      } else {
        return DEFAULT_FPS;
      }
    }
  
    // Clean up resources
    stop() {
      clearInterval(this.rppgTimer);
      clearInterval(this.scanTimer);
      if (this.webcam) {
        this.webcamVideoElement.pause();
        this.webcamVideoElement.srcObject = null;
      }
      if (this.stream) {
        this.stream.getVideoTracks()[0].stop();
      }
      this.invalidateFace();
      this.streaming = false;
      this.frameRGB.delete();
      this.lastFrameGray.delete();
      this.frameGray.delete();
      this.overlayMask.delete();

      if (this.fgMask) this.fgMask.delete();
    }
  }
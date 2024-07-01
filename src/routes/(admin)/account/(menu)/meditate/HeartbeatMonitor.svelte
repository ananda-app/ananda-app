<script lang="ts">
  import { onMount } from "svelte"
  import { Heartbeat } from "$lib/heartbeat.js"
  import Chart from "chart.js/auto"
  import type {
    ChartConfiguration,
    ChartData,
    Chart as ChartType,
  } from "chart.js"

  let chart: ChartType
  let heartRate: number = 0
  let startTime: Date
  let webcamId: string = "webcam"
  let canvasId: string = "canvas"
  let chartCanvas: HTMLCanvasElement
  const OPENCV_URI: string = "/opencv.js"
  const HAARCASCADE_URI: string = "/haarcascade_frontalface_alt.xml"

  let isVideoLoaded = false

  function handleVideoLoaded() {
    isVideoLoaded = true
    initializeChart()
  }

  async function loadOpenCv(uri: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const tag: HTMLScriptElement = document.createElement("script")
      tag.src = uri
      tag.async = true
      tag.type = "text/javascript"
      tag.onload = () => {
        ;(window as any).cv["onRuntimeInitialized"] = () => {
          resolve()
        }
      }
      tag.onerror = () => {
        reject(new URIError("opencv didn't load correctly."))
      }
      const firstScriptTag = document.getElementsByTagName("script")[0]
      if (firstScriptTag?.parentNode) {
        firstScriptTag.parentNode.insertBefore(tag, firstScriptTag)
      } else {
        document.head.appendChild(tag)
      }
    })
  }

  function initializeChart(): void {
    const ctx = chartCanvas?.getContext("2d")
    if (!ctx) return

    const config: ChartConfiguration = {
      type: "line",
      data: {
        labels: [],
        datasets: [
          {
            label: "Heart Rate (BPM)",
            data: [],
            borderColor: "rgb(75, 192, 192)",
            tension: 0.1,
            fill: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: {
          duration: 0,
        },
        scales: {
          x: {
            type: "linear",
            title: {
              display: true,
              text: "Time (seconds)",
            },
            min: 0,
            max: 120,
          },
          y: {
            beginAtZero: false,
            min: 20,
            max: 120,
            title: {
              display: true,
              text: "BPM",
            },
          },
        },
      },
    }

    chart = new Chart(ctx, config)
  }

  const medianFilterWindowSize: number = 5
  let bpmHistory: number[] = []

  function updateChart(bpm: number): void {
    if (!chart) return

    const now = new Date()
    const elapsedSeconds = (now.getTime() - startTime.getTime()) / 1000

    bpmHistory.push(bpm)
    if (bpmHistory.length > medianFilterWindowSize) {
      bpmHistory.shift()
    }

    const sortedHistory = [...bpmHistory].sort((a, b) => a - b)
    const mid = Math.floor(sortedHistory.length / 2)
    const medianBpm =
      sortedHistory.length % 2 !== 0
        ? sortedHistory[mid]
        : (sortedHistory[mid - 1] + sortedHistory[mid]) / 2

    // Explicitly cast the labels and data to the appropriate types
    const labels = chart.data.labels as number[]
    const data = chart.data.datasets[0].data as number[]

    labels.push(elapsedSeconds)
    data.push(medianBpm)

    while (labels.length > 0 && labels[0] < elapsedSeconds - 120) {
      labels.shift()
      data.shift()
    }

    if (chart.options && chart.options.scales && chart.options.scales.x) {
      chart.options.scales.x.min = Math.max(0, elapsedSeconds - 120)
      chart.options.scales.x.max = elapsedSeconds
    }

    chart.update()
  }

  async function initializeApp() {
    await loadOpenCv(OPENCV_URI)

    startTime = new Date()
    const demo = new Heartbeat(
      webcamId,
      canvasId,
      HAARCASCADE_URI,
      30,
      6,
      250,
      (bpm: number) => {
        heartRate = bpm
        updateChart(bpm)
      },
    )

    demo.init()

    return () => {
      demo.stop()
    }
  }

  onMount(() => {
    initializeApp().catch((error) => {
      console.error("Error initializing app:", error)
    })
  })
</script>

<main>
  <div class="container">
    <div class="video-container">
      <video
        id={webcamId}
        on:loadedmetadata={handleVideoLoaded}
        width="360"
        height="640"
        autoplay
        muted
      ></video>
      <canvas id={canvasId} width="360" height="640"></canvas>
    </div>
    <div class="chart-container">
      <canvas bind:this={chartCanvas}></canvas>
    </div>
  </div>
</main>

<style>
  .container {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 20px;
    width: 100%;
    max-width: 1200px;
    margin: 0 auto;
  }
  .video-container {
    position: relative;
    width: 100%;
    max-width: 360px;
    aspect-ratio: 9/16;
  }
  #webcam,
  #canvas {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
  }
  .chart-container {
    width: 100%;
    height: 250px;
  }

  @media (min-width: 768px) {
    .container {
      flex-direction: row;
      align-items: flex-start;
    }
    .video-container {
      flex-shrink: 0;
    }
    .chart-container {
      flex: 1;
      min-width: 600px;
    }
  }
</style>

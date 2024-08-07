<script lang="ts">
  import { onMount, onDestroy } from "svelte"
  import { Biometrics } from "$lib/biometrics.js"
  import Chart from "chart.js/auto"
  import type { ChartConfiguration, Chart as ChartType } from "chart.js"
  import { loadOpenCv } from "$lib/opencvLoader"
  import type { SupabaseClient } from "@supabase/supabase-js" // Import the type

  export let supabase: SupabaseClient // Explicitly type supabase
  export let meditationId: string | null

  let heartRateChart: ChartType
  let breathingRateChart: ChartType
  let movementChart: ChartType
  let startTime: Date
  let webcamId: string = "webcam"
  let canvasId: string = "canvas"
  let heartRateChartCanvas: HTMLCanvasElement
  let breathingRateChartCanvas: HTMLCanvasElement
  let movementChartCanvas: HTMLCanvasElement

  const OPENCV_URI: string = "/opencv.js"
  const HAARCASCADE_URI: string = "/haarcascade_frontalface_alt.xml"
  const CHART_DURATION_SECONDS = 30
  const HR_WINDOW_SIZE = 20 // seconds
  const BR_WINDOW_SIZE = 24 // seconds
  const RPPG_INTERVAL = 2500 // milliseconds

  let isVideoLoaded = false
  let biometricsMonitor: Biometrics | null = null

  async function saveBiometrics(data: {
    ts: number
    bpm: number
    brpm: number
    movement: number
    elapsedSeconds: number
    meditationId: string | null
  }) {
    try {
      const { error } = await supabase.from("biometrics").insert({
        ts: new Date(data.ts).toISOString(),
        meditation_id: data.meditationId,
        bpm: data.bpm,
        brpm: data.brpm,
        movement: data.movement,
        elapsed_seconds: data.elapsedSeconds,
      })

      if (error) throw error

      return { success: true }
    } catch (error) {
      console.error("Error saving biometrics:", error)
      throw error
    }
  }

  function handleVideoLoaded() {
    isVideoLoaded = true
    initializeCharts()
  }

  function initializeCharts(): void {
    initializeChart(
      heartRateChartCanvas,
      "Heart Rate (BPM)",
      "BPM",
      40,
      160,
      "rgb(75, 192, 192)", // Color for heart rate chart
      (chart) => {
        heartRateChart = chart
      },
    )
    initializeChart(
      breathingRateChartCanvas,
      "Breathing Rate (BRPM)",
      "BRPM",
      0,
      40,
      "rgb(255, 99, 132)", // Color for breathing rate chart
      (chart) => {
        breathingRateChart = chart
      },
    )
    initializeChart(
      movementChartCanvas,
      "Movement",
      "Movement Score",
      0,
      100,
      "rgb(255, 159, 64)", // Color for movement chart
      (chart) => {
        movementChart = chart
      },
    )
  }

  function initializeChart(
    canvas: HTMLCanvasElement,
    label: string,
    yAxisLabel: string,
    yMin: number,
    yMax: number,
    borderColor: string,
    setChart: (chart: ChartType) => void,
  ): void {
    const ctx = canvas?.getContext("2d")
    if (!ctx) return

    const config: ChartConfiguration = {
      type: "line",
      data: {
        labels: [],
        datasets: [
          {
            label,
            data: [],
            borderColor,
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
            max: CHART_DURATION_SECONDS,
          },
          y: {
            beginAtZero: false,
            min: yMin,
            max: yMax,
            title: {
              display: true,
              text: yAxisLabel,
            },
          },
        },
      },
    }

    const chart = new Chart(ctx, config)
    setChart(chart)
  }

  function updateChart(
    chart: ChartType,
    value: number,
    elapsedSeconds: number,
  ): void {
    if (!chart) return

    const labels = chart.data.labels as number[]
    const data = chart.data.datasets[0].data as number[]

    labels.push(elapsedSeconds)
    data.push(value)

    while (
      labels.length > 0 &&
      labels[0] < elapsedSeconds - CHART_DURATION_SECONDS
    ) {
      labels.shift()
      data.shift()
    }

    if (chart.options?.scales?.x) {
      chart.options.scales.x.min = Math.max(
        0,
        elapsedSeconds - CHART_DURATION_SECONDS,
      )
      chart.options.scales.x.max = elapsedSeconds
    }

    chart.update()
  }

  async function initializeApp() {
    await loadOpenCv(OPENCV_URI)

    if (biometricsMonitor) {
      biometricsMonitor.stop()
    }

    startTime = new Date()
    biometricsMonitor = new Biometrics(
      webcamId,
      canvasId,
      HAARCASCADE_URI,
      30, // fps
      HR_WINDOW_SIZE, // hrWindowSize
      BR_WINDOW_SIZE, // brWindowSize
      RPPG_INTERVAL, // rppgInterval
      ({
        bpm,
        brpm,
        movement,
        timestamp,
      }: {
        bpm: number
        brpm: number
        movement: number
        timestamp: number
      }) => {
        const elapsedSeconds = Math.floor(
          (timestamp - startTime.getTime()) / 1000,
        )

        updateChart(heartRateChart, bpm, elapsedSeconds)
        updateChart(breathingRateChart, brpm, elapsedSeconds)
        updateChart(movementChart, movement, elapsedSeconds)

        saveBiometrics({
          ts: Date.now(),
          bpm,
          brpm,
          movement,
          elapsedSeconds,
          meditationId,
        })
      },
    )
    biometricsMonitor.init()

    return () => {
      if (biometricsMonitor) {
        biometricsMonitor.stop()
        biometricsMonitor = null
      }
    }
  }

  onMount(() => {
    initializeApp().catch((error) => {
      console.error("Error initializing app:", error)
    })
  })

  onDestroy(() => {
    if (biometricsMonitor) {
      biometricsMonitor.stop()
      biometricsMonitor = null
    }
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
    <div class="charts-container">
      <div class="chart-container">
        <canvas bind:this={heartRateChartCanvas}></canvas>
      </div>
      <div class="chart-container">
        <canvas bind:this={breathingRateChartCanvas}></canvas>
      </div>
      <div class="chart-container">
        <canvas bind:this={movementChartCanvas}></canvas>
      </div>
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
    object-fit: cover;
  }
  .charts-container {
    display: flex;
    flex-direction: column;
    width: 100%;
    max-width: 600px;
    gap: 20px;
  }
  .chart-container {
    width: 100%;
    height: 200px;
  }

  @media (min-width: 768px) {
    .container {
      flex-direction: row;
      align-items: flex-start;
    }
    .video-container {
      flex-shrink: 0;
    }
    .charts-container {
      flex: 1;
      min-width: 600px;
    }
  }
</style>

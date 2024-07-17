<script lang="ts">
  import { onMount } from "svelte"
  import Chart from "chart.js/auto"
  import annotationPlugin from "chartjs-plugin-annotation"
  import { LinearScale } from "chart.js"
  import "chartjs-adapter-date-fns"

  Chart.register(LinearScale, annotationPlugin)

  function smoothData(data: any[], windowSize: number) {
    return data.map((point, index, array) => {
      const start = Math.max(0, index - windowSize + 1)
      const end = index + 1
      const window = array.slice(start, end)
      const sum = window.reduce((acc, curr) => acc + curr.y, 0)
      return {
        x: point.x,
        y: sum / window.length,
      }
    })
  }

  export let biometrics: Array<{
    ts: string
    bpm: number
    brpm: number
    movement: number
  }>
  export let instructions: Array<{
    id: number
    ts: string
    instruction: string
  }>

  let chartCanvasBPM: HTMLCanvasElement
  let chartCanvasBRPM: HTMLCanvasElement
  let chartCanvasMovement: HTMLCanvasElement

  function createChart(
    canvas: HTMLCanvasElement,
    label: string,
    color: string,
    data: any[],
    sessionDurationMinutes: number,
    annotationData: any[],
  ) {
    const ctx = canvas.getContext("2d")
    if (ctx) {
      new Chart(ctx, {
        type: "line",
        data: {
          datasets: [
            {
              label: label,
              data: data,
              borderColor: color,
              backgroundColor: color.replace("1)", "0.2)"),
            },
          ],
        },
        options: {
          responsive: true,
          scales: {
            x: {
              type: "linear",
              title: { display: true, text: "Elapsed Time (minutes)" },
              min: 0,
              max: sessionDurationMinutes,
              ticks: {
                callback: function (value, index, values) {
                  return Math.round(value as number)
                },
              },
            },
            y: {
              title: { display: true, text: label },
            },
          },
          plugins: {
            tooltip: {
              callbacks: {
                title: (context) =>
                  `Elapsed Time: ${context[0].parsed.x.toFixed(2)} minutes`,
                afterBody: (context) => {
                  const elapsedMinutes = context[0].parsed.x
                  const instruction = annotationData.find(
                    (i) => Math.abs(i.elapsedMinutes - elapsedMinutes) < 0.1, // Adjust tolerance as needed
                  )
                  return instruction
                    ? `Instruction: ${instruction.instruction}`
                    : ""
                },
              },
            },
            annotation: {
              annotations: annotationData.map((instr) => ({
                type: "line",
                xMin: instr.elapsedMinutes,
                xMax: instr.elapsedMinutes,
                borderColor: "rgba(255, 0, 0, 0.5)",
                borderWidth: 2,
                label: {
                  content: instr.instruction,
                  enabled: true,
                  position: "center",
                },
              })),
            },
          },
        },
      })
    }
  }

  onMount(() => {
    // Ensure biometrics are sorted by timestamp
    biometrics.sort(
      (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime(),
    )

    // Ensure instructions are sorted by timestamp
    instructions.sort(
      (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime(),
    )

    const startTime = new Date(biometrics[0].ts).getTime()
    const endTime = new Date(biometrics[biometrics.length - 1].ts).getTime()
    const sessionDurationMinutes = (endTime - startTime) / (1000 * 60) // Duration in minutes

    const processedBiometrics = biometrics.map((b) => ({
      x: (new Date(b.ts).getTime() - startTime) / (1000 * 60), // Convert to minutes
      y: b.bpm,
    }))

    const processedInstructions = instructions.map((instr) => ({
      ...instr,
      elapsedMinutes: (new Date(instr.ts).getTime() - startTime) / (1000 * 60), // Convert to minutes
    }))

    createChart(
      chartCanvasBPM,
      "BPM",
      "rgba(255, 99, 132, 1)",
      processedBiometrics,
      sessionDurationMinutes,
      processedInstructions,
    )
    createChart(
      chartCanvasBRPM,
      "BRPM",
      "rgba(54, 162, 235, 1)",
      biometrics.map((b) => ({
        x: (new Date(b.ts).getTime() - startTime) / (1000 * 60), // Convert to minutes
        y: b.brpm,
      })),
      sessionDurationMinutes,
      processedInstructions,
    )
    createChart(
      chartCanvasMovement,
      "Movement",
      "rgba(75, 192, 192, 1)",
      biometrics.map((b) => ({
        x: (new Date(b.ts).getTime() - startTime) / (1000 * 60), // Convert to minutes
        y: b.movement,
      })),
      sessionDurationMinutes,
      processedInstructions,
    )
  })
</script>

<div class="chart-container" style="position: relative; width:100%">
  <canvas bind:this={chartCanvasBPM} style="height:30vh; margin-bottom:20px;"
  ></canvas>
  <canvas bind:this={chartCanvasBRPM} style="height:30vh; margin-bottom:20px;"
  ></canvas>
  <canvas bind:this={chartCanvasMovement} style="height:30vh;"></canvas>
</div>

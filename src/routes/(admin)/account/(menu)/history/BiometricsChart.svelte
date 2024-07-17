<script lang="ts">
  import { onMount } from "svelte"
  import { Chart, LinearScale } from "chart.js"
  import type { TooltipModel, ChartType } from "chart.js"
  import annotationPlugin from "chartjs-plugin-annotation"
  import "chartjs-adapter-date-fns"

  Chart.register(LinearScale, annotationPlugin)

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

  function createChart(
    canvas: HTMLCanvasElement,
    label: string,
    color: string,
    originalData: any[],
    smoothedData: any[],
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
              label: `${label} (Original)`,
              data: originalData,
              borderColor: color.replace("1)", "0.3)"),
              backgroundColor: "transparent",
              pointRadius: 2,
              borderWidth: 1,
              order: 3,
            },
            {
              label: `${label} (Smoothed)`,
              data: smoothedData,
              borderColor: color,
              backgroundColor: "transparent",
              borderWidth: 2,
              tension: 0.4,
              pointRadius: 0,
              order: 2,
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
            legend: {
              display: true,
            },
            tooltip: {
              enabled: false,
              external: function (context) {
                let tooltipEl = document.getElementById("chartjs-tooltip")

                if (!tooltipEl) {
                  tooltipEl = document.createElement("div")
                  tooltipEl.id = "chartjs-tooltip"
                  tooltipEl.innerHTML = "<table></table>"
                  document.body.appendChild(tooltipEl)
                }

                const tooltipModel = context.tooltip as TooltipModel<ChartType>
                if (tooltipModel.opacity === 0) {
                  tooltipEl.style.opacity = "0"
                  return
                }

                tooltipEl.classList.remove("above", "below", "no-transform")
                if (tooltipModel.yAlign) {
                  tooltipEl.classList.add(tooltipModel.yAlign)
                } else {
                  tooltipEl.classList.add("no-transform")
                }

                function getBody(bodyItem: any) {
                  return bodyItem.lines
                }

                if (tooltipModel.body) {
                  const titleLines = tooltipModel.title || []
                  const bodyLines = tooltipModel.body.map(getBody)

                  let innerHtml = "<thead>"

                  titleLines.forEach(function (title) {
                    innerHtml += "<tr><th>" + title + "</th></tr>"
                  })
                  innerHtml += "</thead><tbody>"

                  bodyLines.forEach(function (body, i) {
                    const colors = tooltipModel.labelColors[i]
                    let style = "background:" + colors.backgroundColor
                    style += "; border-color:" + colors.borderColor
                    style += "; border-width: 2px"
                    const span =
                      '<span style="' + style + '">' + body + "</span>"
                    innerHtml += "<tr><td>" + span + "</td></tr>"
                  })

                  const instruction = annotationData.find(
                    (i) =>
                      Math.abs(
                        i.elapsedMinutes - tooltipModel.dataPoints[0].parsed.x,
                      ) < 0.1,
                  )
                  if (instruction) {
                    innerHtml +=
                      "<tr><td>Instruction: " +
                      instruction.instruction +
                      "</td></tr>"
                  }

                  innerHtml += "</tbody>"

                  let tableRoot = tooltipEl.querySelector("table")
                  tableRoot!.innerHTML = innerHtml
                }

                const position = context.chart.canvas.getBoundingClientRect()
                const bodyFont = Chart.defaults.font

                tooltipEl.style.opacity = "1"
                tooltipEl.style.position = "absolute"
                tooltipEl.style.left =
                  position.left + window.scrollX + tooltipModel.caretX + "px"
                tooltipEl.style.top =
                  position.top + window.scrollY + tooltipModel.caretY + "px"
                tooltipEl.style.font =
                  bodyFont.family + ", " + bodyFont.size + "px"
                tooltipEl.style.padding = "10px"
                tooltipEl.style.pointerEvents = "none"
                tooltipEl.style.maxWidth = "300px"
                tooltipEl.style.whiteSpace = "normal"
              },
            },
            annotation: {
              annotations: annotationData.map((instr) => {
                const closestDataPoint = smoothedData.reduce((prev, curr) =>
                  Math.abs(curr.x - instr.elapsedMinutes) <
                  Math.abs(prev.x - instr.elapsedMinutes)
                    ? curr
                    : prev,
                )
                return {
                  type: "point",
                  xValue: instr.elapsedMinutes,
                  yValue: closestDataPoint.y,
                  backgroundColor: "rgba(255, 0, 0, 1)",
                  borderColor: "white",
                  borderWidth: 2,
                  radius: 8,
                  hitRadius: 12,
                  hoverRadius: 10,
                  hoverBorderWidth: 3,
                  label: {
                    enabled: false,
                  },
                }
              }),
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

    const windowSize = 5 // Adjust this value to change the smoothing level

    // Process BPM data
    const bpmData = biometrics.map((b) => ({
      x: (new Date(b.ts).getTime() - startTime) / (1000 * 60), // Convert to minutes
      y: b.bpm,
    }))
    const smoothedBPM = smoothData(bpmData, windowSize)

    // Process BRPM data
    const brpmData = biometrics.map((b) => ({
      x: (new Date(b.ts).getTime() - startTime) / (1000 * 60),
      y: b.brpm,
    }))
    const smoothedBRPM = smoothData(brpmData, windowSize)

    // Process Movement data
    const movementData = biometrics.map((b) => ({
      x: (new Date(b.ts).getTime() - startTime) / (1000 * 60),
      y: b.movement,
    }))
    const smoothedMovement = smoothData(movementData, windowSize)

    const processedInstructions = instructions.map((instr) => ({
      ...instr,
      elapsedMinutes: (new Date(instr.ts).getTime() - startTime) / (1000 * 60), // Convert to minutes
    }))

    createChart(
      chartCanvasBPM,
      "BPM",
      "rgba(255, 99, 132, 1)",
      bpmData,
      smoothedBPM,
      sessionDurationMinutes,
      processedInstructions,
    )
    createChart(
      chartCanvasBRPM,
      "BRPM",
      "rgba(54, 162, 235, 1)",
      brpmData,
      smoothedBRPM,
      sessionDurationMinutes,
      processedInstructions,
    )
    createChart(
      chartCanvasMovement,
      "Movement",
      "rgba(75, 192, 192, 1)",
      movementData,
      smoothedMovement,
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

<style>
  :global(#chartjs-tooltip) {
    background: rgba(0, 0, 0, 0.7);
    color: white;
    border-radius: 3px;
    font-size: 14px;
    max-width: 300px;
    word-wrap: break-word;
  }

  :global(#chartjs-tooltip table) {
    margin: 0;
  }

  :global(#chartjs-tooltip td) {
    padding: 2px 4px;
  }
</style>

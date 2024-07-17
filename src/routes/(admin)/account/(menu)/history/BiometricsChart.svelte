<script lang="ts">
  import { onMount } from "svelte"
  import Chart from "chart.js/auto"
  import annotationPlugin from "chartjs-plugin-annotation"
  import { TimeScale } from "chart.js"
  import "chartjs-adapter-date-fns"

  Chart.register(TimeScale, annotationPlugin)

  export let biometrics: any[]
  export let instructions: any[]

  let chartCanvasBPM: HTMLCanvasElement
  let chartCanvasBRPM: HTMLCanvasElement
  let chartCanvasMovement: HTMLCanvasElement

  function createChart(
    canvas: HTMLCanvasElement,
    label: string,
    color: string,
    data: any[],
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
              type: "time",
              time: { unit: "second" },
              title: { display: true, text: "Time" },
            },
            y: {
              title: { display: true, text: label },
            },
          },
          plugins: {
            tooltip: {
              callbacks: {
                afterBody: (context) => {
                  const time = context[0].parsed.x
                  const instruction = instructions.find(
                    (i) => Math.abs(new Date(i.ts).getTime() - time) < 1000,
                  )
                  return instruction
                    ? `Instruction: ${instruction.instruction}`
                    : ""
                },
              },
            },
            annotation: {
              annotations: instructions.map((instr) => ({
                type: "line",
                xMin: new Date(instr.ts).getTime(),
                xMax: new Date(instr.ts).getTime(),
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
    createChart(
      chartCanvasBPM,
      "BPM",
      "rgba(255, 99, 132, 1)",
      biometrics.map((b) => ({ x: new Date(b.ts), y: b.bpm })),
    )
    createChart(
      chartCanvasBRPM,
      "BRPM",
      "rgba(54, 162, 235, 1)",
      biometrics.map((b) => ({ x: new Date(b.ts), y: b.brpm })),
    )
    createChart(
      chartCanvasMovement,
      "Movement",
      "rgba(75, 192, 192, 1)",
      biometrics.map((b) => ({ x: new Date(b.ts), y: b.movement })),
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

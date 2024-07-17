export function formatTechnique(technique: string): string {
  const techniqueMap: { [key: string]: string } = {
    loving_kindness: "Loving Kindness",
    body_scan: "Body Scan",
    breath_focus: "Breath Focus",
  };
  return techniqueMap[technique] || technique;
}
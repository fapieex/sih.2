$ErrorActionPreference = 'Stop'
$src = 'C:\Users\epicd\Desktop\SIH\SIH2026_Idea_Submission_AICTE_Approval_Platform.pptx'
$outDir = 'C:\Users\epicd\Desktop\SIH\screenshots\render'
if (Test-Path $outDir) { Remove-Item "$outDir\*" -Force } else { New-Item -ItemType Directory -Path $outDir | Out-Null }

$app = New-Object -ComObject Kwpp.Application
$pres = $app.Presentations.Open($src, $true, $false, $false)
$count = $pres.Slides.Count
Write-Output "Slides: $count"
for ($i = 1; $i -le $count; $i++) {
  $png = Join-Path $outDir ("slide" + $i + ".png")
  $pres.Slides.Item($i).Export($png, "PNG", 1920, 1080)
}
$pres.Close()
$app.Quit()
Write-Output ("Exported " + $count + " slides to " + $outDir)
Get-ChildItem $outDir | ForEach-Object { Write-Output ($_.Name + " " + $_.Length) }

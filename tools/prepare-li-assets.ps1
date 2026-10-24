$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Join-Path $PSScriptRoot '..'
$source = Join-Path $root 'packages/client/public/assets/characters/li/source'
$output = Join-Path $root 'packages/client/public/assets/characters/li/processed'
New-Item -ItemType Directory -Path $output -Force | Out-Null

function Export-Crop([string]$sourceName, [string]$targetName, [int]$x, [int]$y, [int]$width, [int]$height) {
  $inputPath = Join-Path $source $sourceName
  $outputPath = Join-Path $output $targetName
  $image = [System.Drawing.Bitmap]::new($inputPath)
  try {
    if ($x -lt 0 -or $y -lt 0 -or ($x + $width) -gt $image.Width -or ($y + $height) -gt $image.Height) {
      throw "Crop outside source bounds: $sourceName"
    }
    $rect = [System.Drawing.Rectangle]::new($x, $y, $width, $height)
    $crop = $image.Clone($rect, $image.PixelFormat)
    try { $crop.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png) }
    finally { $crop.Dispose() }
  }
  finally { $image.Dispose() }
}

# Individual, unmodified pose crops. White background is intentionally retained.
Export-Crop 'Gemini_Generated_Image_te2krete2krete2k (1).jpg' 'li_idle_reference.png' 400 0 1200 2048
Export-Crop 'Gemini_Generated_Image_te2krete2krete2k (2).jpg' 'li_attack_forward_reference.png' 150 0 1500 2048
Export-Crop 'Gemini_Generated_Image_te2krete2krete2k (4).jpg' 'li_special_trap_place_reference.png' 260 0 1400 2048
Export-Crop 'Gemini_Generated_Image_te2krete2krete2k (5).jpg' 'li_special_trap_throw_reference.png' 260 0 1788 2048
Export-Crop 'Gemini_Generated_Image_te2krete2krete2k (6).jpg' 'li_special_bottle_throw_reference.png' 260 0 1400 2048

# The two lower trap illustrations in source (1) have clear separation; crop separately.
Export-Crop 'Gemini_Generated_Image_te2krete2krete2k (1).jpg' 'trap_closed_reference.png' 120 1440 800 600
Export-Crop 'Gemini_Generated_Image_te2krete2krete2k (1).jpg' 'trap_open_reference.png' 1060 1220 950 810

# Bottle is isolated in source (8); preserve exact source pixels.
Export-Crop 'Gemini_Generated_Image_te2krete2krete2k (8).jpg' 'bottle_reference.png' 1290 0 550 1080

# Full design sheet is retained as a single reference image.
Export-Crop 'Gemini_Generated_Image_te2krete2krete2k.jpg' 'li_turnaround_reference.png' 0 0 2752 1536

Get-ChildItem -LiteralPath $output -File | Select-Object Name, Length

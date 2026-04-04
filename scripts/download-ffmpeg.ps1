# Download FFmpeg for Windows and place in binaries/ with target triple suffix
$ProgressPreference = 'SilentlyContinue'
$binDir = Join-Path $PSScriptRoot "src-tauri\binaries"
$ffmpegVersion = "8.1"
$url = "https://github.com/GyanD/codexffmpeg/releases/download/$ffmpegVersion/ffmpeg-$ffmpegVersion-essentials_build.zip"
$zipPath = Join-Path $env:TEMP "ffmpeg.zip"
$extractDir = Join-Path $env:TEMP "ffmpeg-extract"

Write-Host "Downloading FFmpeg $ffmpegVersion for Windows..."
Invoke-WebRequest -Uri $url -OutFile $zipPath -UseBasicParsing

Write-Host "Extracting..."
Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force

$binFolder = Get-ChildItem -Path $extractDir -Directory | Select-Object -First 1
$ffmpegExe = Join-Path $binFolder.FullName "bin\ffmpeg.exe"
$ffprobeExe = Join-Path $binFolder.FullName "bin\ffprobe.exe"

$target = "x86_64-pc-windows-msvc"
Copy-Item $ffmpegExe (Join-Path $binDir "ffmpeg-$target.exe") -Force
Copy-Item $ffprobeExe (Join-Path $binDir "ffprobe-$target.exe") -Force

Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
Remove-Item $extractDir -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "Done! Binaries copied to src-tauri\binaries\"
Write-Host "  - ffmpeg-$target.exe"
Write-Host "  - ffprobe-$target.exe"

param(
    [Parameter(Mandatory = $true)][ValidatePattern('^\d+\.\d+\.\d+$')][string]$Version,
    [ValidateSet("windows", "macos", "all")][string]$Platform = "windows",
    [ValidateSet("amd64", "arm64")][string]$Arch = "amd64",
    [ValidatePattern('^$|^\d+\.\d+\.\d+$')][string]$MinVersion = "",
    [string]$NotesFile = "CHANGELOG.md"
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$binDir = Join-Path $projectRoot "bin"
$outputDir = Join-Path (Join-Path $binDir "update") $Version
$manifest = Join-Path $outputDir "latest.json"
$wails = "D:\Envir\go\bin\wails3.exe"

if (-not (Test-Path -LiteralPath $wails)) {
    $wails = (Get-Command wails3 -ErrorAction Stop).Source
}

function New-DarwinBundleZip {
    param([string]$Source, [string]$Destination)

    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    if (Test-Path -LiteralPath $Destination) { Remove-Item -LiteralPath $Destination -Force }
    $sourceParent = Split-Path -Parent $Source
    $items = @((Get-Item -LiteralPath $Source)) + @(Get-ChildItem -LiteralPath $Source -Recurse -Force)
    $archive = [IO.Compression.ZipFile]::Open($Destination, [IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($item in $items) {
            $relative = $item.FullName.Substring($sourceParent.Length).TrimStart([char[]]@('\', '/')).Replace('\', '/')
            if ($item.PSIsContainer) {
                $entry = $archive.CreateEntry($relative.TrimEnd('/') + '/')
                $entry.ExternalAttributes = [int](0x41ED -shl 16)
                continue
            }
            $entry = $archive.CreateEntry($relative, [IO.Compression.CompressionLevel]::Optimal)
            $executable = $relative -match '\.app/Contents/MacOS/[^/]+$'
            $entry.ExternalAttributes = [int](($(if ($executable) { 0x81ED } else { 0x81A4 })) -shl 16)
            $inputStream = [IO.File]::OpenRead($item.FullName)
            $outputStream = $entry.Open()
            try { $inputStream.CopyTo($outputStream) } finally { $outputStream.Dispose(); $inputStream.Dispose() }
        }
    } finally {
        $archive.Dispose()
    }
}

$targets = if ($Platform -eq "all") { @("windows", "macos") } else { @($Platform) }
$artifacts = @()
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

foreach ($target in $targets) {
    if ($target -eq "windows") {
        $source = Join-Path $binDir "Nonoka Sub X.exe"
        if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
            throw "Missing Windows build artifact: $source"
        }
        $artifact = Join-Path $outputDir "Nonoka-Sub-X-$Version-windows-$Arch.exe"
        Copy-Item -LiteralPath $source -Destination $artifact -Force
    } else {
        $source = Join-Path $binDir "Nonoka Sub X.app"
        if (-not (Test-Path -LiteralPath $source -PathType Container)) {
            throw "Missing macOS app bundle: $source"
        }
        $artifact = Join-Path $outputDir "Nonoka-Sub-X-$Version-darwin-universal.zip"
        New-DarwinBundleZip -Source $source -Destination $artifact
    }
    $artifacts += $artifact
}

$arguments = @(
    "updater", "manifest",
    "-version", $Version,
    "-channel", "stable",
    "-name", "Nonoka Sub X $Version",
    "-output", $manifest
)
$notesPath = Join-Path $projectRoot $NotesFile
if (-not (Test-Path -LiteralPath $notesPath -PathType Leaf)) {
    # Check workspace root if not found in desktop root
    $workspaceRoot = Split-Path -Parent $projectRoot
    $workspaceNotes = Join-Path $workspaceRoot $NotesFile
    if (Test-Path -LiteralPath $workspaceNotes -PathType Leaf) {
        $notesPath = $workspaceNotes
    } else {
        throw "Missing release notes file: $notesPath"
    }
}

$manifestNotesPath = $notesPath
$changelogPath = $notesPath
$temporaryNotesPath = $null
if ([IO.Path]::GetFileName($notesPath) -ieq "CHANGELOG.md") {
    $changelog = [IO.File]::ReadAllText($changelogPath)
    $escapedVersion = [regex]::Escape($Version)
    $section = [regex]::Match($changelog, "(?ms)^##[ \t]+(?:v)?$escapedVersion[ \t]*\r?\n(.*?)(?=^##[ \t]+|\z)")
    if (-not $section.Success -or [string]::IsNullOrWhiteSpace($section.Groups[1].Value)) {
        throw "Missing or empty CHANGELOG.md section for version $Version"
    }
    $temporaryNotesPath = [IO.Path]::GetTempFileName()
    [IO.File]::WriteAllText($temporaryNotesPath, $section.Groups[1].Value.Trim(), [Text.UTF8Encoding]::new($false))
    $manifestNotesPath = $temporaryNotesPath
}
$arguments += @("-notes-file", $manifestNotesPath)
$arguments += $artifacts
try {
    & $wails @arguments
    if ($LASTEXITCODE -ne 0) { throw "Failed to generate update manifest" }
} finally {
    if ($temporaryNotesPath) { Remove-Item -LiteralPath $temporaryNotesPath -Force }
}

if ($MinVersion) {
    $data = Get-Content -LiteralPath $manifest -Raw -Encoding UTF8 | ConvertFrom-Json
    $data | Add-Member -NotePropertyName metadata -NotePropertyValue @{ minVersion = $MinVersion } -Force
    $json = $data | ConvertTo-Json -Depth 10
    [IO.File]::WriteAllText($manifest, $json, [Text.UTF8Encoding]::new($false))
}

& $wails updater verify -manifest $manifest -dir $outputDir
if ($LASTEXITCODE -ne 0) { throw "Update artifact digest verification failed" }

Write-Host "Update artifacts generated and verified: $outputDir"

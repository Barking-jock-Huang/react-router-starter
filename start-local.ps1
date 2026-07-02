param(
  [ValidateSet("dev", "preview", "build")]
  [string]$Mode = "dev",
  [string]$HostName = "127.0.0.1",
  [int]$Port = 5173
)

$ErrorActionPreference = "Stop"

function Resolve-Node {
  $candidates = @(
    "C:\Users\TBDuser\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
  )

  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) {
    $candidates += $cmd.Source
  }

  foreach ($candidate in $candidates | Select-Object -Unique) {
    if (!$candidate -or !(Test-Path $candidate)) {
      continue
    }

    try {
      & $candidate --version *> $null
      return (Resolve-Path $candidate).Path
    } catch {
      continue
    }
  }

  throw "Cannot find a working node.exe. Install Node.js or run this inside the Codex desktop environment."
}

function Resolve-NpmCli {
  $npmRoot = Join-Path $env:TEMP "codex-npm-cli"
  $npmCli = Join-Path $npmRoot "package\bin\npm-cli.js"

  if (!(Test-Path $npmCli)) {
    $tgz = Join-Path $env:TEMP "npm-11.6.2.tgz"
    if (Test-Path $npmRoot) {
      Remove-Item -LiteralPath $npmRoot -Recurse -Force
    }

    New-Item -ItemType Directory -Path $npmRoot | Out-Null
    Invoke-WebRequest -Uri "https://registry.npmjs.org/npm/-/npm-11.6.2.tgz" -OutFile $tgz
    tar -xzf $tgz -C $npmRoot
  }

  return $npmCli
}

$node = Resolve-Node
$npmCli = Resolve-NpmCli
$nodeDir = Split-Path $node -Parent
$env:PATH = "$nodeDir;$env:PATH"

switch ($Mode) {
  "dev" {
    & $node $npmCli run dev -- --host $HostName --port $Port
  }
  "preview" {
    & $node $npmCli run preview -- --host $HostName --port $Port
  }
  "build" {
    & $node $npmCli run build
  }
}

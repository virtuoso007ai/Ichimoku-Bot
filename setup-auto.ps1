# ACP: create agent without piping stdin into `acp setup`.
# Piping breaks after async browser login (readline closes before agent prompts).
# `agent create` calls ensureSession() — browser opens only if session is missing/expired.
# Custom agent name: .\setup-auto.ps1 -AgentName "MyAgent"
# Optional token launch + ACP skill text: run `.\run-acp.cmd setup` interactively afterward.

param(
  [string]$AgentName = "Ichimoku Kinko Hyo"
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host ""
Write-Host "Virtuals ACP: sign in in the browser if prompted; then the agent is created." -ForegroundColor Cyan
Write-Host ('Agent name: ' + $AgentName + '.') -ForegroundColor Cyan
Write-Host ""

& "$PSScriptRoot\run-acp.cmd" agent create "$AgentName"

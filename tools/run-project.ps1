$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$startedProcesses = New-Object System.Collections.Generic.List[System.Diagnostics.Process]
$stopRequested = $false

function Stop-ProjectProcesses {
    param([switch]$IncludeServer)

    $targets = Get-CimInstance Win32_Process | Where-Object {
        ($_.Name -eq 'python.exe' -and $_.CommandLine -match 'apps[\\/]browser-worker[\\/]worker\.py') -or
        ($_.Name -eq 'chrome.exe' -and $_.CommandLine -match 'remote-debugging-port=9242') -or
        ($IncludeServer -and $_.Name -eq 'node.exe' -and $_.CommandLine -match 'apps[\\/]server[\\/]dist[\\/]index\.js')
    }

    foreach ($target in $targets) {
        try {
            Stop-Process -Id $target.ProcessId -Force -ErrorAction SilentlyContinue
        } catch {
            # 进程可能已经退出，继续清理其他目标。
        }
    }
}

function Stop-StartedProcesses {
    foreach ($process in $startedProcesses) {
        try {
            if (-not $process.HasExited) {
                Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
            }
        } catch {
            # 进程可能已经退出。
        }
    }
    Stop-ProjectProcesses -IncludeServer
}

try {
    # 启动前清理本项目残留进程，避免端口或 Profile 被占用。
    Stop-ProjectProcesses -IncludeServer

    Write-Host '[1/3] Installing Node.js dependencies if needed...'
    if (-not (Test-Path 'node_modules')) {
        npm install
        if ($LASTEXITCODE -ne 0) { throw 'npm install failed.' }
    } else {
        Write-Host 'Node.js dependencies are ready.'
    }

    Write-Host '[2/3] Building application...'
    npm run build
    if ($LASTEXITCODE -ne 0) { throw 'Application build failed.' }

    Write-Host '[3/3] Starting Temu Analytics...'
    $openBrowser = Start-Process -FilePath 'node' -ArgumentList 'tools\open-browser-when-ready.mjs' -WorkingDirectory $root -PassThru -WindowStyle Hidden
    $startedProcesses.Add($openBrowser)

    # 不再通过 cmd.exe /c npm start 启动服务。
    # 嵌套 cmd 会在 Ctrl+C 时连续显示“终止批处理操作吗(Y/N)?”，并把 Ctrl+C
    # 转换成“命令语法不正确”。直接启动已构建的 Node 入口可避免该问题。
    while (-not $stopRequested) {
        & node 'apps/server/dist/index.js'
        $exitCode = $LASTEXITCODE
        if ($exitCode -eq 75 -and -not $stopRequested) {
            Write-Host 'Backup restored. Restarting service...'
            Start-Sleep -Seconds 2
            continue
        }
        break
    }

    if ($stopRequested) {
        exit 0
    }
    exit $exitCode
} finally {
    Stop-StartedProcesses
}

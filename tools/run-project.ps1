$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$startedProcesses = New-Object System.Collections.Generic.List[System.Diagnostics.Process]
$stopRequested = $false

function Invoke-NativeCheck {
    param([Parameter(Mandatory = $true)][scriptblock]$Command)

    $previousErrorActionPreference = $ErrorActionPreference
    try {
        # PowerShell 5.1 会把原生命令写入 stderr 的内容包装为 NativeCommandError。
        # 依赖探测失败属于预期分支，应通过退出码判断，而不是中断启动脚本。
        $ErrorActionPreference = 'SilentlyContinue'
        & $Command *> $null
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }

    return $exitCode
}

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

    Write-Host '[1/5] Installing Node.js dependencies if needed...'
    if (-not (Test-Path 'node_modules')) {
        npm install
        if ($LASTEXITCODE -ne 0) { throw 'npm install failed.' }
    } else {
        Write-Host 'Node.js dependencies are ready.'
    }

    Write-Host '[2/5] Checking Python...'
    $pythonCheckExitCode = Invoke-NativeCheck { python --version }
    if ($pythonCheckExitCode -ne 0) { throw 'Python was not found. Install Python 3.12 or later and add it to PATH.' }

    Write-Host '[3/5] Checking CloakBrowser...'
    $cloakBrowserImportExitCode = Invoke-NativeCheck { python -c 'import cloakbrowser' }
    if ($cloakBrowserImportExitCode -ne 0) {
        Write-Host 'CloakBrowser Python package was not found. Installing dependencies...'
        python -m pip install -r apps\browser-worker\requirements.txt
        if ($LASTEXITCODE -ne 0) { throw 'CloakBrowser dependencies installation failed.' }
    }
    $cloakBrowserBinaryExitCode = Invoke-NativeCheck {
        python -c "from cloakbrowser import binary_info; raise SystemExit(0 if binary_info().get('installed') else 1)"
    }
    if ($cloakBrowserBinaryExitCode -ne 0) {
        Write-Host 'Installing CloakBrowser binary. The first download may take several minutes...'
        python -m cloakbrowser install
        if ($LASTEXITCODE -ne 0) { throw 'CloakBrowser binary installation failed.' }
    }

    Write-Host '[4/5] Building application...'
    npm run build
    if ($LASTEXITCODE -ne 0) { throw 'Application build failed.' }

    Write-Host '[5/5] Starting Temu Analytics...'
    $openBrowser = Start-Process -FilePath 'node' -ArgumentList 'tools\open-browser-when-ready.mjs' -WorkingDirectory $root -PassThru -WindowStyle Hidden
    $startedProcesses.Add($openBrowser)

    while (-not $stopRequested) {
        & cmd.exe /d /c "npm start"
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

$null = Register-EngineEvent -SourceIdentifier PowerShell.Exiting -Action {
    # 保留退出钩子，确保窗口关闭时进入 finally 清理流程。
}

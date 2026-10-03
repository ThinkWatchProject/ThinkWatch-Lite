<#
Windows 上的端到端检查：把 x64 的绿色版和安装程序当成用户那样用一遍。

发版流水线的 `windows-e2e` 跑它（见 .github/workflows/release.yml），用的是 Windows
自带的 PowerShell 5.1。没有真机测试，这里就是绿色版、单实例、安装版和卸载在 Windows
上真的能用的证据。每一条查什么：

 1. 绿色版启动：解压到 P1 启动，数据（config.yaml、control.port）在 `P1\data`，
    `%APPDATA%\ThinkWatch` 不出现；网关是 P1 里的那个 twcore.exe；thinkwatch:// 链接
    指向 P1，系统通知登记了 `app.thinkwatch.lite.portable`（名字、PNG 图标）。
 2. 第二份、切换：P1 运行时启动 P2，P2 弹系统对话框说明 P1 在哪；按「停止运行中的
    程序并启动此程序」后 P1 和它的 twcore 退出，P2 用它自己的 `data` 起来，链接改指 P2。
 3. 第二份、取消：P2 运行时再开 P1，按「取消」：P1 退出，P2 照常运行，链接还指 P2。
 4. 同一个 exe 再开一次：不弹框，第二个进程很快退出，P2 照常运行。
 5. 没有写入权限：P3 对当前用户拒绝写入，启动后弹「This folder is not writable」，
    按「OK」后退出码是 1，没有建出 `data`。
 6. 安装版：P2 正常退出后静默安装（/S），启动装好的那一份：数据在 `%APPDATA%\ThinkWatch`，
    链接指向安装目录里的 exe，登记了 `app.thinkwatch.lite`。
 7. 卸载：开机自启指向 P2，关掉安装版、静默卸载：指向安装版
    的链接和通知登记删掉了，指向 P2 的开机自启还在，`%APPDATA%\ThinkWatch` 还在（静默
    卸载不勾「同时删除数据」）。再对 P2 跑 `--uninstall-cleanup --delete-data`：退出码 0，
    `P2\data` 没了，HKCU 里没有指向 P2 的项。
 8. WebView2：runner 上没有 WebView2 运行时、或者应用启动时弹了「缺少 WebView2」，
    明确报出来，而不是在后面某一步莫名其妙地超时。

界面是英文的（runner 的系统语言），所以对的是 `tr!` 里的英文句子：single.rs、
portable.rs、webview2.rs。文件名照 tw-api 的 `control::CONFIG_FILE` / `PORT_FILE`。

每一次等待都有上限；失败时打印找到了什么（窗口、进程、注册表、数据目录、应用日志），
截一张全屏图。结束时（不论成败）关掉留下的进程。应用的标准输出（tracing 日志）
写在 `<Out>\logs` 里，截图在 `<Out>\shots` 里。

**这个文件要存成带 BOM 的 UTF-8**：PowerShell 5.1 读不带 BOM 的文件按 ANSI 解，中文
注释和提示会乱码，乱码里的弯引号还会被它当成字符串的引号。
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string] $Setup,
    [Parameter(Mandatory = $true)] [string] $Zip,
    [Parameter(Mandatory = $true)] [string] $Out
)

$ErrorActionPreference = 'Stop'
# 日志里的中文：runner 按 UTF-8 读这个进程的输出
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch {}

Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Drawing, System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class TwE2E {
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);

    // 鼠标移过去、左键按下再抬起，和人点一下一样
    public static void Click(int x, int y) {
        SetCursorPos(x, y);
        mouse_event(0x0002, 0, 0, 0, UIntPtr.Zero);
        mouse_event(0x0004, 0, 0, 0, UIntPtr.Zero);
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern IntPtr CreateFileW(string name, uint access, uint share, IntPtr sa, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern uint GetFinalPathNameByHandleW(IntPtr h, StringBuilder buf, uint len, uint flags);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);

    // 和应用里的 std::fs::canonicalize + plain_path 一样：展开链接、短文件名，去掉 \\?\
    public static string FinalPath(string path) {
        IntPtr h = CreateFileW(path, 0, 7, IntPtr.Zero, 3, 0x02000000, IntPtr.Zero);
        if (h == new IntPtr(-1)) return path;
        try {
            StringBuilder sb = new StringBuilder(32768);
            uint n = GetFinalPathNameByHandleW(h, sb, (uint)sb.Capacity, 0);
            if (n == 0 || n >= sb.Capacity) return path;
            string s = sb.ToString();
            if (s.StartsWith(@"\\?\UNC\")) return @"\\" + s.Substring(8);
            if (s.StartsWith(@"\\?\")) return s.Substring(4);
            return s;
        } finally {
            CloseHandle(h);
        }
    }
}
'@
# 截图按真实像素截，不被系统缩放虚拟化
[void][TwE2E]::SetProcessDPIAware()

$AE = [System.Windows.Automation.AutomationElement]
$TS = [System.Windows.Automation.TreeScope]

# ---- 应用里的名字和句子（改了那边，这里跟着改） ----

$Identifier = 'app.thinkwatch.lite'          # tauri.conf.json 的 identifier
$Product = 'ThinkWatch Lite'                 # productName：开机自启的值名、通知上的名字
$ExeName = 'thinkwatch-lite.exe'
$CoreName = 'twcore.exe'
$ConfigFile = 'config.yaml'                  # tw_api::control::CONFIG_FILE
$PortFile = 'control.port'                   # tw_api::control::PORT_FILE
$IconFile = 'notification-icon.png'          # winreg::NOTIFICATION_ICON
$Handoff = "Local\$Identifier-handoff"       # single::handoff_name
$AumidInstalled = $Identifier                # notices::windows::aumid(false)
$AumidPortable = "$Identifier.portable"      # notices::windows::aumid(true)
$LinkKey = 'HKCU:\Software\Classes\thinkwatch'
$LinkCommandKey = "$LinkKey\shell\open\command"
$AumidRoot = 'HKCU:\Software\Classes\AppUserModelId'
$RunKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$InstalledData = Join-Path $env:APPDATA 'ThinkWatch'

$Text = @{
    Running         = 'ThinkWatch Lite is already running'
    RunningAt       = 'The running program is at {0}. Only one ThinkWatch Lite can run at a time.'
    SwitchOver      = 'Stop the running program and start this one'
    Cancel          = 'Cancel'
    # 后面是一个省略号（U+2026），只比前面这一段
    Waiting         = 'Waiting for requests in progress to finish'
    NotWritable     = 'This folder is not writable'
    NotWritableBody = 'Extract ThinkWatch Lite to a writable location and run it again.'
    OK              = 'OK'
    WebView2        = 'WebView2'
}

# 对话框按钮的编号：dialog.rs 的 FIRST_BUTTON 起。鼠标点不下去时，退回给对话框
# 发 TDM_CLICK_BUTTON
$FirstButton = 100
$TDM_CLICK_BUTTON = 0x0466   # WM_USER + 102

# ---- 目录 ----

$Shots = Join-Path $Out 'shots'
$Logs = Join-Path $Out 'logs'
New-Item -ItemType Directory -Force -Path $Shots, $Logs | Out-Null
$Base = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [IO.Path]::GetTempPath() }
$Root = Join-Path $Base 'tw-e2e'
$P1 = Join-Path $Root 'P1'
# 第二份的路径里带空格：对话框里的路径、注册表里的引号都要经得起
$P2 = Join-Path $Root 'portable two'
$P3 = Join-Path $Root 'P3'
$P1exe = Join-Path $P1 $ExeName
$P2exe = Join-Path $P2 $ExeName
$P3exe = Join-Path $P3 $ExeName

# ---- 记录 ----

$script:Started = Get-Date
$script:Check = 'setup'
$script:Results = New-Object System.Collections.Generic.List[object]
$script:Warnings = New-Object System.Collections.Generic.List[string]
$script:AppLogs = New-Object System.Collections.Generic.List[string]
$script:ShotCount = 0
$script:DenySid = $null

function Say([string] $message) {
    Write-Host ('[{0,6:N1}s] {1}' -f ((Get-Date) - $script:Started).TotalSeconds, $message)
}

function Pass([string] $what) {
    $script:Results.Add([pscustomobject]@{ Check = $script:Check; Result = 'pass'; What = $what })
    Say ('PASS [{0}] {1}' -f $script:Check, $what)
}

# 不算失败、但要让人看见的事
function Warn([string] $what) {
    $line = '[{0}] {1}' -f $script:Check, $what
    $script:Warnings.Add($line)
    Say ('WARN ' + $line)
}

function Fail([string] $message) {
    throw (New-Object System.Exception $message)
}

function Start-Check([string] $name) {
    $script:Check = $name
    Say ''
    Say ('==== {0} ====' -f $name)
}

# 全屏截图。截不到（没有交互式桌面）只记一句，不让检查因此失败
function Shot([string] $name) {
    $script:ShotCount++
    $path = Join-Path $Shots ('e2e-{0:D2}-{1}.png' -f $script:ShotCount, $name)
    try {
        $b = [System.Windows.Forms.SystemInformation]::VirtualScreen
        $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        try {
            $g.CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size)
            $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
        } finally {
            $g.Dispose()
            $bmp.Dispose()
        }
        Say ('截图：{0}' -f (Split-Path $path -Leaf))
    } catch {
        Say ('截图 {0} 没截成：{1}' -f $name, $_.Exception.Message)
    }
}

# 在 `seconds` 秒内反复问 `condition`，答出真值就返回它；到点了返回 $null
function Wait-For([scriptblock] $condition, [double] $seconds, [int] $everyMs = 250) {
    $__until = (Get-Date).AddSeconds($seconds)
    while ($true) {
        $__got = & $condition
        if ($__got) { return $__got }
        if ((Get-Date) -ge $__until) { return $null }
        Start-Sleep -Milliseconds $everyMs
    }
}

# ---- 进程 ----

# 启动应用，标准输出和标准错误（tracing 日志）写进 logs。工作目录是 exe 所在的文件夹，
# 和在资源管理器里双击一样
function Start-App([string] $exe, [string] $tag, [string[]] $arguments = @()) {
    $outLog = Join-Path $Logs ('e2e-{0}.out.log' -f $tag)
    $errLog = Join-Path $Logs ('e2e-{0}.err.log' -f $tag)
    $p = @{
        FilePath               = $exe
        WorkingDirectory       = (Split-Path $exe)
        PassThru               = $true
        RedirectStandardOutput = $outLog
        RedirectStandardError  = $errLog
    }
    if ($arguments.Count -gt 0) { $p.ArgumentList = $arguments }
    $proc = Start-Process @p
    # 先把句柄取出来：PowerShell 5.1 里不这样做，进程退出之后 ExitCode 是空的
    $null = $proc.Handle
    $script:AppLogs.Add($outLog)
    $script:AppLogs.Add($errLog)
    Say ('启动 {0}（pid {1}）：{2} {3}' -f $tag, $proc.Id, $exe, ($arguments -join ' '))
    return $proc
}

# 跑的是 `exe` 这个文件的那些进程
function Get-ProcsAt([string] $exe) {
    $leaf = Split-Path $exe -Leaf
    return @(Get-CimInstance Win32_Process -Filter ("Name='{0}'" -f $leaf) |
            Where-Object { $_.ExecutablePath -and (Same $_.ExecutablePath $exe) })
}

function Wait-Gone([string] $exe, [string] $label, [double] $seconds = 30) {
    $gone = Wait-For { @(Get-ProcsAt $exe).Count -eq 0 } $seconds
    if (-not $gone) {
        Fail ('{0} 在 {1} 秒内没有退出：{2}' -f $label, $seconds, (Get-ProcsAt $exe | ForEach-Object { 'pid ' + $_.ProcessId } | Out-String).Trim())
    }
}

# 像另一份那样请运行中的程序退出（single.rs 的切换事件）：它等手上的请求结束、停掉 core、
# 退出。打不开事件、或者到点没退，就强制结束
function Stop-Gracefully($proc, [string] $label) {
    $sent = $false
    try {
        $ev = [System.Threading.EventWaitHandle]::OpenExisting($Handoff)
        try { $sent = $ev.Set() } finally { $ev.Dispose() }
    } catch {
        Say ('打不开 {0}：{1}' -f $Handoff, $_.Exception.Message)
    }
    if ($sent -and $proc.WaitForExit(120000)) {
        Say ('{0} 已正常退出（退出码 {1}）' -f $label, $proc.ExitCode)
        if ($proc.ExitCode -ne 0) { Warn ('{0} 正常退出时的退出码是 {1}' -f $label, $proc.ExitCode) }
        return
    }
    Warn ('{0} 没能正常退出，强制结束' -f $label)
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    [void]$proc.WaitForExit(30000)
}

# ---- 路径、注册表、文件 ----

function Same([string] $a, [string] $b) {
    if (-not $a -or -not $b) { return $false }
    $na = $a.Trim().Replace('/', '\')
    $nb = $b.Trim().Replace('/', '\')
    if ($na.StartsWith('\\?\')) { $na = $na.Substring(4) }
    if ($nb.StartsWith('\\?\')) { $nb = $nb.Substring(4) }
    return [string]::Equals($na, $nb, [StringComparison]::OrdinalIgnoreCase)
}

# 一条命令行启动的是哪个程序（带引号取引号里那段，不带取到第一个空白）
function Command-Exe([string] $cmd) {
    if (-not $cmd) { return $null }
    $c = $cmd.Trim()
    if ($c.StartsWith('"')) {
        $end = $c.IndexOf('"', 1)
        if ($end -lt 0) { return $c.Substring(1) }
        return $c.Substring(1, $end - 1)
    }
    return ($c -split '\s+')[0]
}

# 注册表里的一个值（默认值用 ''）；键或值不在是 $null。REG_EXPAND_SZ 读出来是展开过的
function Get-Reg([string] $key, [string] $name) {
    try { $k = Get-Item -LiteralPath $key -ErrorAction Stop } catch { return $null }
    try { return $k.GetValue($name) } finally { $k.Close() }
}

function Get-RegKind([string] $key, [string] $name) {
    try { $k = Get-Item -LiteralPath $key -ErrorAction Stop } catch { return $null }
    try { return $k.GetValueKind($name) } catch { return $null } finally { $k.Close() }
}

function Link-Exe { return (Command-Exe (Get-Reg $LinkCommandKey '')) }

function Is-Png([string] $path) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return $false }
    $buf = New-Object byte[] 8
    $fs = [IO.File]::OpenRead($path)
    try { $n = $fs.Read($buf, 0, 8) } finally { $fs.Dispose() }
    return ($n -eq 8 -and (($buf -join ',') -eq '137,80,78,71,13,10,26,10'))
}

function Test-Port([int] $port) {
    $c = New-Object System.Net.Sockets.TcpClient
    try {
        $ar = $c.BeginConnect('127.0.0.1', $port, $null, $null)
        if (-not $ar.AsyncWaitHandle.WaitOne(2000)) { return $false }
        $c.EndConnect($ar)
        return $true
    } catch {
        return $false
    } finally {
        $c.Close()
    }
}

function List-Dir([string] $dir) {
    if (-not (Test-Path -LiteralPath $dir)) { return '（不存在）' }
    $items = @(Get-ChildItem -LiteralPath $dir -Force -ErrorAction SilentlyContinue | ForEach-Object { $_.Name })
    if ($items.Count -eq 0) { return '（空）' }
    return ($items -join ', ')
}

# 应用的日志，读的时候它可能还开着
function Read-Log([string] $path) {
    try {
        $fs = New-Object IO.FileStream($path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]'ReadWrite, Delete')
        $sr = New-Object IO.StreamReader($fs, [Text.Encoding]::UTF8)
        try { $all = $sr.ReadToEnd() } finally { $sr.Dispose() }
        # tracing 带着终端颜色
        return @(($all -replace "\x1b\[[0-9;]*m", '') -split "`r?`n" | Where-Object { $_ })
    } catch {
        return @()
    }
}

# ---- 窗口 ----

function Get-Windows([int] $procId) {
    $cond = New-Object System.Windows.Automation.PropertyCondition($AE::ProcessIdProperty, $procId)
    try { return @($AE::RootElement.FindAll($TS::Children, $cond)) } catch { return @() }
}

# 这个进程的系统对话框（TaskDialog、MessageBox 都是 #32770）
function Get-Dialog([int] $procId) {
    foreach ($w in (Get-Windows $procId)) {
        try { if ($w.Current.ClassName -eq '#32770') { return $w } } catch {}
    }
    return $null
}

# 一个窗口里所有元素的名字：TaskDialog 的标题、主句、正文、按钮都在里面
function Get-Texts($element) {
    $names = New-Object System.Collections.Generic.List[string]
    try { if ($element.Current.Name) { $names.Add($element.Current.Name) } } catch {}
    try {
        foreach ($d in $element.FindAll($TS::Descendants, [System.Windows.Automation.Condition]::TrueCondition)) {
            try { if ($d.Current.Name) { $names.Add($d.Current.Name) } } catch {}
        }
    } catch {}
    return $names.ToArray()
}

# 窗口里所有元素：（控件类型、类名、名字、元素）。按名字找按钮时不限控件类型 ——
# TaskDialog 里的按钮在 UI 自动化里不一定报成 Button
function Get-Parts($element) {
    $parts = New-Object System.Collections.Generic.List[object]
    try {
        foreach ($d in $element.FindAll($TS::Descendants, [System.Windows.Automation.Condition]::TrueCondition)) {
            try {
                $c = $d.Current
                $parts.Add([pscustomobject]@{ Type = $c.ControlType.ProgrammaticName; Class = $c.ClassName; Name = $c.Name; Element = $d })
            } catch {}
        }
    } catch {}
    return $parts.ToArray()
}

function Describe($element) {
    return ((Get-Parts $element | ForEach-Object { '{0} [{1}] "{2}"' -f $_.Type, $_.Class, $_.Name }) -join '; ')
}

# 放到最上层再截图：从后台进程拉起来的对话框不一定在前面
function Raise($element) {
    try {
        $h = [IntPtr]$element.Current.NativeWindowHandle
        # HWND_TOPMOST；SWP_NOSIZE | SWP_NOMOVE | SWP_SHOWWINDOW
        [void][TwE2E]::SetWindowPos($h, [IntPtr](-1), 0, 0, 0, 0, 0x43)
        Start-Sleep -Milliseconds 400
    } catch {}
}

# 等这个进程弹出系统对话框（等到按钮也画出来）。它先退出了、或者到点没弹，算失败
function Wait-Dialog($proc, [string] $label, [double] $seconds = 60) {
    $until = (Get-Date).AddSeconds($seconds)
    while ((Get-Date) -lt $until) {
        $d = Get-Dialog $proc.Id
        if ($d) {
            # 窗口先出来、里面的字和按钮后画：等到有几样东西了再往下
            [void](Wait-For { @(Get-Parts $d | Where-Object { $_.Name }).Count -ge 3 } 5 100)
            Say ('{0} 的对话框：{1}' -f $label, ((Get-Texts $d) -join ' | '))
            Say ('  UI 自动化里的样子：{0}' -f (Describe $d))
            return $d
        }
        if ($proc.HasExited) { Fail ('{0} 没有弹出对话框就退出了（退出码 {1}）' -f $label, $proc.ExitCode) }
        Start-Sleep -Milliseconds 250
    }
    Fail ('{0} 在 {1} 秒内没有弹出对话框' -f $label, $seconds)
}

function Assert-Contains([string[]] $texts, [string] $needle, [string] $what) {
    $all = $texts -join "`n"
    if ($all.IndexOf($needle, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
        Fail ('{0}：对话框里没有「{1}」。对话框里的文字：{2}' -f $what, $needle, ($texts -join ' | '))
    }
}

# 按下对话框里写着 `label` 的按钮，确认对话框随之关掉。
#
# TaskDialog 的按钮在 UI 自动化里是 `Pane [CCPushButton]`，没有 Invoke：那就照它的位置
# 用鼠标点一下，和人点的一样。点了对话框没关，才退回给它发 TDM_CLICK_BUTTON（按编号，
# `index` 是按钮在 dialog::show 里的下标）并记一条提醒；那样也没关，算失败
function Press($dialog, [string] $label, [int] $index) {
    $named = @(Get-Parts $dialog | Where-Object { $_.Name -and $_.Name.Trim() -eq $label })
    if ($named.Count -eq 0) {
        Fail ('对话框里没有「{0}」按钮。对话框里有：{1}' -f $label, (Describe $dialog))
    }
    $hwnd = [IntPtr]$dialog.Current.NativeWindowHandle
    # 同名的几个里挑按钮：能 Invoke 的，其次是 CCPushButton / Button（正文里可能有同样的字）
    $button = $null
    $invoke = $false
    foreach ($n in $named) {
        $pattern = $null
        if ($n.Element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) { $button = $n; $invoke = $true; break }
    }
    if (-not $button) {
        $button = @($named | Where-Object { $_.Class -eq 'CCPushButton' -or $_.Type -eq 'ControlType.Button' }) + $named | Select-Object -First 1
    }
    $how = ''
    try {
        if ($invoke) {
            $button.Element.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
            $how = 'Invoke'
        } else {
            $r = $button.Element.Current.BoundingRectangle
            if ($r.IsEmpty -or $r.Width -le 0) { throw '按钮没有位置' }
            Raise $dialog
            [TwE2E]::Click([int]($r.X + $r.Width / 2), [int]($r.Y + $r.Height / 2))
            $how = '鼠标'
        }
    } catch {
        $how = '失败：' + $_.Exception.Message
    }
    if (Wait-For { -not [TwE2E]::IsWindow($hwnd) } 5 100) {
        Say ('按下了「{0}」（{1}，{2}）' -f $label, $button.Type, $how)
        return
    }
    Warn ('「{0}」按下去对话框没关（{1}），改发 TDM_CLICK_BUTTON' -f $label, $how)
    [void][TwE2E]::PostMessage($hwnd, $TDM_CLICK_BUTTON, [IntPtr]($FirstButton + $index), [IntPtr]::Zero)
    if (-not (Wait-For { -not [TwE2E]::IsWindow($hwnd) } 5 100)) {
        Fail ('「{0}」怎么按对话框都不关' -f $label)
    }
}

# 等主窗口出来再截图（尽量，不强求）
function Shot-Main($proc, [string] $name) {
    $w = Wait-For {
        foreach ($x in (Get-Windows $proc.Id)) {
            try { if ($x.Current.ClassName -ne '#32770' -and -not $x.Current.IsOffscreen) { return $x } } catch {}
        }
    } 20 500
    if ($w) { Start-Sleep -Seconds 3 } else { Say '没等到主窗口，照样截图' }
    Shot $name
}

# ---- 应用起来了 ----

# 等这一份真的起来：数据目录里有了配置和控制面端口，端口连得上，网关是这个文件夹里的
# twcore.exe。等的时候它先退出了、或者弹了对话框（比如缺 WebView2），立刻失败
function Wait-Ready($proc, [string] $data, [string] $folder, [string] $label, [double] $seconds = 120) {
    $cfg = Join-Path $data $ConfigFile
    $portPath = Join-Path $data $PortFile
    $until = (Get-Date).AddSeconds($seconds)
    $port = 0
    while ($true) {
        if ($proc.HasExited) {
            Fail ('{0} 在就绪之前退出了（退出码 {1}）。数据目录 {2}：{3}' -f $label, $proc.ExitCode, $data, (List-Dir $data))
        }
        $d = Get-Dialog $proc.Id
        if ($d) {
            $texts = (Get-Texts $d) -join ' | '
            Raise $d
            Shot ('{0}-unexpected-dialog' -f $label)
            if ($texts -like ('*{0}*' -f $Text.WebView2)) {
                Fail ('{0} 没有启动，弹了缺少 WebView2 运行时的对话框：{1}' -f $label, $texts)
            }
            Fail ('{0} 启动时弹了意外的对话框：{1}' -f $label, $texts)
        }
        if ((Test-Path -LiteralPath $cfg) -and (Test-Path -LiteralPath $portPath)) {
            $raw = ''
            try { $raw = ([IO.File]::ReadAllText($portPath)).Trim() } catch {}
            if ($raw -match '^\d+$' -and (Test-Port ([int]$raw))) { $port = [int]$raw; break }
        }
        if ((Get-Date) -ge $until) {
            Fail ('{0} 在 {1} 秒内没有就绪。数据目录 {2}：{3}' -f $label, $seconds, $data, (List-Dir $data))
        }
        Start-Sleep -Milliseconds 500
    }
    $core = Join-Path $folder $CoreName
    $cores = @(Get-ProcsAt $core)
    if ($cores.Count -lt 1) {
        Fail ('{0} 的网关不是 {1}。在跑的 twcore：{2}' -f $label, $core, ((Get-ProcsAt-Any $CoreName) -join ' | '))
    }
    Pass ('{0} 起来了：{1} 里有 {2}、{3}（端口 {4} 连得上），网关是 {5}（pid {6}）' -f $label, $data, $ConfigFile, $PortFile, $port, $core, $cores[0].ProcessId)
}

function Get-ProcsAt-Any([string] $name) {
    return @(Get-CimInstance Win32_Process -Filter ("Name='{0}'" -f $name) | ForEach-Object { '{0} (pid {1})' -f $_.ExecutablePath, $_.ProcessId })
}

function Assert-Link([string] $exe, [string] $label, [double] $seconds = 30) {
    $ok = Wait-For { Same (Link-Exe) $exe } $seconds
    if (-not $ok) {
        Fail ('thinkwatch:// 链接没有指向 {0}：{1} = {2}' -f $label, $LinkCommandKey, (Get-Reg $LinkCommandKey ''))
    }
    Pass ('thinkwatch:// 链接指向 {0}：{1}' -f $label, (Get-Reg $LinkCommandKey ''))
}

# 系统通知的登记：名字是产品名，图标是数据目录里的一张 PNG
function Assert-Aumid([string] $aumid, [string] $data, [double] $seconds = 30) {
    $key = "$AumidRoot\$aumid"
    $icon = Join-Path $data $IconFile
    $ok = Wait-For { ((Get-Reg $key 'DisplayName') -eq $Product) -and (Same (Get-Reg $key 'IconUri') $icon) } $seconds
    if (-not $ok) {
        Fail ('{0} 的登记不对：DisplayName = {1}，IconUri = {2}；应为 {3}、{4}' -f $key, (Get-Reg $key 'DisplayName'), (Get-Reg $key 'IconUri'), $Product, $icon)
    }
    if (-not (Is-Png $icon)) { Fail ('IconUri 指向的 {0} 不是一张 PNG（或者不存在）' -f $icon) }
    foreach ($v in 'DisplayName', 'IconUri') {
        $kind = Get-RegKind $key $v
        if ("$kind" -ne 'ExpandString') { Warn ('{0} 的 {1} 是 {2}，约定是 REG_EXPAND_SZ' -f $key, $v, $kind) }
    }
    Pass ('登记了 {0}：DisplayName = {1}，IconUri = {2}（PNG）' -f $aumid, $Product, $icon)
}

# HKCU 里这几处所有指向 `folder` 的值
function Find-RegRefs([string] $folder) {
    $hits = New-Object System.Collections.Generic.List[string]
    $keys = @()
    if (Test-Path -LiteralPath $LinkKey) {
        $keys += Get-Item -LiteralPath $LinkKey
        $keys += @(Get-ChildItem -LiteralPath $LinkKey -Recurse)
    }
    if (Test-Path -LiteralPath $AumidRoot) {
        foreach ($k in @(Get-ChildItem -LiteralPath $AumidRoot | Where-Object { $_.PSChildName -like "$Identifier*" })) {
            $keys += $k
            $keys += @(Get-ChildItem -LiteralPath $k.PSPath -Recurse)
        }
    }
    if (Test-Path -LiteralPath $RunKey) { $keys += Get-Item -LiteralPath $RunKey }
    foreach ($k in $keys) {
        foreach ($n in $k.GetValueNames()) {
            $v = "$($k.GetValue($n))"
            if ($v.IndexOf($folder, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
                $hits.Add(('{0} [{1}] = {2}' -f $k.Name, $n, $v))
            }
        }
    }
    return $hits.ToArray()
}

# ---- 失败时看现场 ----

function Dump-State {
    Say ''
    Say '---- 进程 ----'
    Get-CimInstance Win32_Process |
        Where-Object { $_.Name -in @('thinkwatch-lite.exe', 'twcore.exe', 'uninstall.exe', 'msedgewebview2.exe') -or $_.Name -like 'Un_*.exe' -or $_.Name -like 'Au_*.exe' } |
        ForEach-Object { Say ('  pid {0}（父 {1}）{2} | {3}' -f $_.ProcessId, $_.ParentProcessId, $_.ExecutablePath, $_.CommandLine) }
    Say '---- 顶层窗口 ----'
    try {
        foreach ($w in @($AE::RootElement.FindAll($TS::Children, [System.Windows.Automation.Condition]::TrueCondition))) {
            try {
                $c = $w.Current
                Say ('  pid {0} [{1}] {2}' -f $c.ProcessId, $c.ClassName, $c.Name)
                if ($c.ClassName -eq '#32770') { Say ('    ' + ((Get-Texts $w) -join ' | ')) }
            } catch {}
        }
    } catch { Say ('  列不出窗口：' + $_.Exception.Message) }
    Say '---- 注册表 ----'
    Say ('  {0} = {1}' -f $LinkCommandKey, (Get-Reg $LinkCommandKey ''))
    Say ('  {0} [{1}] = {2}' -f $RunKey, $Product, (Get-Reg $RunKey $Product))
    if (Test-Path -LiteralPath $AumidRoot) {
        foreach ($k in @(Get-ChildItem -LiteralPath $AumidRoot | Where-Object { $_.PSChildName -like "$Identifier*" })) {
            Say ('  {0}: DisplayName = {1}, IconUri = {2}' -f $k.PSChildName, $k.GetValue('DisplayName'), $k.GetValue('IconUri'))
        }
    }
    Say '---- 数据目录 ----'
    foreach ($d in (Join-Path $P1 'data'), (Join-Path $P2 'data'), (Join-Path $P3 'data'), $InstalledData) {
        Say ('  {0}: {1}' -f $d, (List-Dir $d))
    }
    Say '---- 应用日志（各取最后 40 行） ----'
    foreach ($log in $script:AppLogs) {
        $lines = Read-Log $log
        if ($lines.Count -eq 0) { continue }
        Say ('  == ' + (Split-Path $log -Leaf))
        $lines | Select-Object -Last 40 | ForEach-Object { Write-Host ('    ' + $_) }
    }
}

# ---- 收尾 ----

function Stop-Leftovers {
    foreach ($name in 'thinkwatch-lite.exe', 'twcore.exe') {
        foreach ($p in @(Get-CimInstance Win32_Process -Filter ("Name='{0}'" -f $name))) {
            Say ('结束留下的进程：pid {0} {1}' -f $p.ProcessId, $p.ExecutablePath)
            Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
        }
    }
    # 应用的 WebView2 子进程（用户数据目录在这几份的 data 下，或者安装版默认的那个位置）
    foreach ($p in @(Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'")) {
        if ("$($p.CommandLine)" -match [regex]::Escape($Root) -or "$($p.CommandLine)" -match [regex]::Escape($Identifier)) {
            Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
        }
    }
    if ($script:DenySid) {
        & icacls.exe $P3 /remove:d ('*' + $script:DenySid) | Out-Null
        $script:DenySid = $null
    }
}

# 应用自己报的警告和错误：检查都过了也列出来，可能是值得看的问题
function Show-AppWarnings {
    $lines = New-Object System.Collections.Generic.List[string]
    foreach ($log in $script:AppLogs) {
        foreach ($l in (Read-Log $log)) {
            if ($l -match '\b(WARN|ERROR)\b' -or $l -match 'panicked') {
                $lines.Add(('{0}: {1}' -f (Split-Path $log -Leaf), $l.Trim()))
            }
        }
    }
    Say ''
    Say ('---- 应用日志里的 WARN / ERROR：{0} 行 ----' -f $lines.Count)
    $lines | ForEach-Object { Write-Host ('  ' + $_) }
    return $lines.ToArray()
}

function Write-Summary([string] $failure, [string[]] $appWarnings) {
    if (-not $env:GITHUB_STEP_SUMMARY) { return }
    $md = New-Object System.Text.StringBuilder
    [void]$md.AppendLine('## Windows end-to-end (x64)')
    [void]$md.AppendLine()
    if ($failure) {
        [void]$md.AppendLine(('**FAILED** in `{0}`: {1}' -f $script:Check, $failure))
        [void]$md.AppendLine()
    }
    [void]$md.AppendLine('| Check | Result | What |')
    [void]$md.AppendLine('|---|---|---|')
    foreach ($r in $script:Results) {
        [void]$md.AppendLine(('| {0} | {1} | {2} |' -f $r.Check, $r.Result, ($r.What -replace '\|', '\|')))
    }
    if ($script:Warnings.Count -gt 0) {
        [void]$md.AppendLine()
        [void]$md.AppendLine('### Warnings')
        foreach ($w in $script:Warnings) { [void]$md.AppendLine('- ' + $w) }
    }
    if ($appWarnings.Count -gt 0) {
        [void]$md.AppendLine()
        [void]$md.AppendLine('### WARN / ERROR lines in the app logs')
        [void]$md.AppendLine('```')
        foreach ($l in $appWarnings) { [void]$md.AppendLine($l) }
        [void]$md.AppendLine('```')
    }
    [void]$md.AppendLine()
    [void]$md.AppendLine('Screenshots: artifact `e2e-shots`; app logs: artifact `e2e-logs`.')
    [IO.File]::AppendAllText($env:GITHUB_STEP_SUMMARY, $md.ToString(), (New-Object System.Text.UTF8Encoding $false))
}

# ==== 各条检查 ====

function Check-Prerequisites {
    Start-Check '0 prerequisites'
    foreach ($f in $Setup, $Zip) { if (-not (Test-Path -LiteralPath $f)) { Fail ('没有 {0}' -f $f) } }
    Say ('安装程序：{0}' -f $Setup)
    Say ('绿色版：{0}' -f $Zip)
    $os = Get-CimInstance Win32_OperatingSystem
    Say ('系统：{0} {1}，界面语言 {2}' -f $os.Caption, $os.Version, (Get-UICulture).Name)
    $screen = [System.Windows.Forms.SystemInformation]::VirtualScreen
    Say ('屏幕：{0}x{1}' -f $screen.Width, $screen.Height)

    # 8. WebView2：没有它应用开不了窗口，只会弹「缺少 WebView2」—— 先在这里说清楚
    $guid = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
    $wv = $null
    foreach ($k in "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\$guid",
        "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\$guid",
        "HKCU:\Software\Microsoft\EdgeUpdate\Clients\$guid") {
        $v = Get-Reg $k 'pv'
        if ($v -and $v -ne '0.0.0.0') { $wv = $v; break }
    }
    if (-not $wv) {
        Fail '这台 runner 上没有 Microsoft Edge WebView2 运行时（EdgeUpdate 的注册表里查不到版本号）：应用只会弹「缺少 WebView2」的对话框而不会启动，后面的检查无从做起'
    }
    Pass ('WebView2 运行时 {0}' -f $wv)

    # 干净的起点：runner 是一次性的，有旧东西就清掉并说一声
    foreach ($n in 'thinkwatch-lite', 'twcore') {
        if (Get-Process -Name $n -ErrorAction SilentlyContinue) { Fail ('开始之前已经有 {0} 在运行' -f $n) }
    }
    if (Test-Path -LiteralPath $InstalledData) {
        Warn ('开始之前就有 {0}（{1}），删掉' -f $InstalledData, (List-Dir $InstalledData))
        Remove-Item -LiteralPath $InstalledData -Recurse -Force
    }
    foreach ($k in $LinkKey, "$AumidRoot\$AumidInstalled", "$AumidRoot\$AumidPortable") {
        if (Test-Path -LiteralPath $k) { Warn ('开始之前就有 {0}，删掉' -f $k); Remove-Item -LiteralPath $k -Recurse -Force }
    }
    if ($null -ne (Get-Reg $RunKey $Product)) {
        Warn ('开始之前 Run 里就有 {0}，删掉' -f $Product)
        Remove-ItemProperty -LiteralPath $RunKey -Name $Product
    }
    if (Test-Path -LiteralPath $Root) { Remove-Item -LiteralPath $Root -Recurse -Force }
    foreach ($dir in $P1, $P2) {
        Expand-Archive -LiteralPath $Zip -DestinationPath $dir -Force
        Say ('解压到 {0}：{1}' -f $dir, (List-Dir $dir))
    }
    # 绿色版在文件夹之外留没留下东西：先记下这几处原来在不在
    $script:Outside = @{}
    foreach ($d in (Join-Path $env:LOCALAPPDATA $Identifier), (Join-Path $env:APPDATA $Identifier)) {
        $script:Outside[$d] = Test-Path -LiteralPath $d
    }
}

function Check-PortableStart {
    Start-Check '1 portable start'
    $script:proc1 = Start-App $P1exe 'p1'
    Wait-Ready $script:proc1 (Join-Path $P1 'data') $P1 'P1'
    if (Test-Path -LiteralPath $InstalledData) {
        Fail ('绿色版建出了 {0}：{1}' -f $InstalledData, (List-Dir $InstalledData))
    }
    Pass ('{0} 没有出现' -f $InstalledData)
    Assert-Link $P1exe 'P1'
    Assert-Aumid $AumidPortable (Join-Path $P1 'data')
    $webview = Join-Path $P1 'data\webview'
    if (Test-Path -LiteralPath $webview) { Pass ('WebView2 的数据在 {0}' -f $webview) }
    else { Warn ('没有 {0}：WebView2 的数据不在绿色版的文件夹里？' -f $webview) }
    Shot-Main $script:proc1 'p1-running'
}

function Check-Switch {
    Start-Check '2 second copy: switch'
    $P1core = Join-Path $P1 $CoreName
    $script:proc2 = Start-App $P2exe 'p2'
    $dialog = Wait-Dialog $script:proc2 'P2'
    Raise $dialog
    Shot 'p2-asks-to-switch'
    $texts = Get-Texts $dialog
    Assert-Contains $texts $Text.Running '主句'
    # 对话框里的路径是规范化过的（canonicalize），两种写法都认
    $shown = $texts -join "`n"
    $want = @(($Text.RunningAt -f [TwE2E]::FinalPath($P1exe)), ($Text.RunningAt -f $P1exe))
    if (-not ($want | Where-Object { $shown.IndexOf($_, [StringComparison]::OrdinalIgnoreCase) -ge 0 })) {
        Fail ('正文没有说 P1 在哪。应为「{0}」，对话框里的文字：{1}' -f $want[0], ($texts -join ' | '))
    }
    Pass ('P2 弹了对话框，说明运行中的程序位于 {0}' -f $P1exe)
    Press $dialog $Text.SwitchOver 0

    # 等待对话框只在 P1 收尾的那一两秒里出现：赶上了就截一张，赶不上不算失败
    $caught = $false
    $until = (Get-Date).AddSeconds(20)
    while ((Get-Date) -lt $until -and -not $script:proc1.HasExited) {
        $d = Get-Dialog $script:proc2.Id
        if ($d) {
            $t = Get-Texts $d
            if (($t -join ' ') -like ('*{0}*' -f $Text.Waiting)) {
                Raise $d
                Shot 'p2-waits-for-p1'
                Say ('等待对话框：{0}' -f ($t -join ' | '))
                $caught = $true
                break
            }
        }
        Start-Sleep -Milliseconds 100
    }
    if (-not $caught) { Say '没赶上等待对话框（P1 退得快），不影响结果' }

    if (-not $script:proc1.WaitForExit(120000)) { Fail 'P1 在 120 秒内没有退出' }
    Pass ('P1 退出了（退出码 {0}）' -f $script:proc1.ExitCode)
    if ($script:proc1.ExitCode -ne 0) { Warn ('P1 让位时的退出码是 {0}' -f $script:proc1.ExitCode) }
    Wait-Gone $P1core 'P1 的 twcore.exe'
    Pass 'P1 的 twcore.exe 退出了'
    Wait-Ready $script:proc2 (Join-Path $P2 'data') $P2 'P2'
    Assert-Link $P2exe 'P2'
    Assert-Aumid $AumidPortable (Join-Path $P2 'data')
    if ($script:proc2.HasExited) { Fail 'P2 起来之后又退出了' }
    Shot-Main $script:proc2 'p2-running'
}

function Check-Cancel {
    Start-Check '3 second copy: cancel'
    $again = Start-App $P1exe 'p1-again'
    $dialog = Wait-Dialog $again 'P1（再开一次）'
    Raise $dialog
    Shot 'p1-asks-again'
    $texts = Get-Texts $dialog
    $shown = $texts -join "`n"
    $want = @(($Text.RunningAt -f [TwE2E]::FinalPath($P2exe)), ($Text.RunningAt -f $P2exe))
    if (-not ($want | Where-Object { $shown.IndexOf($_, [StringComparison]::OrdinalIgnoreCase) -ge 0 })) {
        Fail ('正文没有说 P2 在哪。应为「{0}」，对话框里的文字：{1}' -f $want[0], ($texts -join ' | '))
    }
    Press $dialog $Text.Cancel 1
    if (-not $again.WaitForExit(30000)) { Fail '按了取消，P1 在 30 秒内没有退出' }
    Pass ('按了取消，P1 退出了（退出码 {0}）' -f $again.ExitCode)
    Start-Sleep -Seconds 2
    if ($script:proc2.HasExited) { Fail ('P2 不该退出，退出码 {0}' -f $script:proc2.ExitCode) }
    if (@(Get-ProcsAt (Join-Path $P2 $CoreName)).Count -lt 1) { Fail 'P2 的 twcore.exe 不在了' }
    if (-not (Same (Link-Exe) $P2exe)) { Fail ('取消之后链接不该改，现在是 {0}' -f (Get-Reg $LinkCommandKey '')) }
    Pass 'P2 和它的网关照常运行，链接仍指向 P2'
}

function Check-SameExe {
    Start-Check '4 same exe twice'
    $again = Start-App $P2exe 'p2-again'
    $sw = [Diagnostics.Stopwatch]::StartNew()
    while (-not $again.HasExited -and $sw.Elapsed.TotalSeconds -lt 30) {
        $d = Get-Dialog $again.Id
        if ($d) {
            $t = (Get-Texts $d) -join ' | '
            Raise $d
            Shot 'p2-again-unexpected-dialog'
            Fail ('同一个程序再开一次不该弹对话框：{0}' -f $t)
        }
        Start-Sleep -Milliseconds 200
    }
    if (-not $again.HasExited) { Fail '第二个进程 30 秒内没有退出' }
    Pass ('没有弹框，第二个进程 {0:N1} 秒后退出（退出码 {1}）' -f $sw.Elapsed.TotalSeconds, $again.ExitCode)
    Start-Sleep -Seconds 1
    if ($script:proc2.HasExited) { Fail ('P2 不该退出，退出码 {0}' -f $script:proc2.ExitCode) }
    Pass 'P2 照常运行'
    Shot 'p2-brought-to-front'
}

function Check-NotWritable {
    Start-Check '5 folder not writable'
    Expand-Archive -LiteralPath $Zip -DestinationPath $P3 -Force
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    # 只拒绝「建文件、建子目录、写属性」这几项。简写的 (W) 里还带着 SYNCHRONIZE 和
    # READ_CONTROL，拒绝它们连 exe 都打不开
    & icacls.exe $P3 /deny ('*{0}:(OI)(CI)(WD,AD,WEA,WA)' -f $sid) | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail ('icacls 没能拒绝写入（退出码 {0}）' -f $LASTEXITCODE) }
    $script:DenySid = $sid
    # 确认真的写不进：管理员身份不该绕过一条拒绝
    $probe = Join-Path $P3 'probe'
    $denied = $false
    try { [IO.File]::WriteAllText($probe, 'x') } catch { $denied = $true }
    if (-not $denied) { Remove-Item -LiteralPath $probe -Force; Fail '拒绝写入之后这里照样写得进，模拟不了没有写入权限的文件夹' }
    Say ('已拒绝 {0} 写入 {1}' -f $sid, $P3)

    $proc3 = Start-App $P3exe 'p3'
    $dialog = Wait-Dialog $proc3 'P3'
    Raise $dialog
    Shot 'p3-not-writable'
    $texts = Get-Texts $dialog
    Assert-Contains $texts $Text.NotWritable '主句'
    Assert-Contains $texts $Text.NotWritableBody '正文'
    Pass '弹了「This folder is not writable」'
    Press $dialog $Text.OK 0
    if (-not $proc3.WaitForExit(30000)) { Fail '按了 OK，P3 在 30 秒内没有退出' }
    if ($proc3.ExitCode -ne 1) { Fail ('退出码应为 1，实际是 {0}' -f $proc3.ExitCode) }
    if (Test-Path -LiteralPath (Join-Path $P3 'data')) { Fail ('不该建出 {0}' -f (Join-Path $P3 'data')) }
    Pass '退出码 1，没有建出 data'
    if ($script:proc2.HasExited) { Fail 'P2 不该退出' }
    & icacls.exe $P3 /remove:d ('*' + $sid) | Out-Null
    $script:DenySid = $null
}

function Check-Installed {
    Start-Check '6 installed copy'
    Stop-Gracefully $script:proc2 'P2'
    Wait-Gone (Join-Path $P2 $CoreName) 'P2 的 twcore.exe'
    Pass 'P2 和它的网关退出了'

    # 绿色版这几份都跑过了：文件夹之外不该留下数据
    if (Test-Path -LiteralPath $InstalledData) {
        Fail ('绿色版建出了 {0}：{1}' -f $InstalledData, (List-Dir $InstalledData))
    }
    foreach ($d in $script:Outside.Keys) {
        if (-not $script:Outside[$d] -and (Test-Path -LiteralPath $d)) {
            Warn ('绿色版跑过之后多了 {0}：{1}' -f $d, (List-Dir $d))
        }
    }
    Pass ('绿色版跑完，{0} 仍不存在' -f $InstalledData)

    $installer = Start-Process -FilePath $Setup -ArgumentList '/S' -PassThru
    $null = $installer.Handle
    if (-not $installer.WaitForExit(600000)) { Fail '静默安装 10 分钟没有结束' }
    if ($installer.ExitCode -ne 0) { Fail ('静默安装的退出码是 {0}' -f $installer.ExitCode) }
    $script:InstDir = Find-InstallDir
    if (-not $script:InstDir) { Fail '装完找不到安装目录（卸载项里没有 ThinkWatch Lite）' }
    foreach ($f in $ExeName, $CoreName, 'uninstall.exe') {
        if (-not (Test-Path -LiteralPath (Join-Path $script:InstDir $f))) {
            Fail ('安装目录 {0} 里没有 {1}：{2}' -f $script:InstDir, $f, (List-Dir $script:InstDir))
        }
    }
    Pass ('静默安装到了 {0}：{1}' -f $script:InstDir, (List-Dir $script:InstDir))

    $script:InstExe = Join-Path $script:InstDir $ExeName
    $script:procInst = Start-App $script:InstExe 'installed'
    Wait-Ready $script:procInst $InstalledData $script:InstDir 'installed'
    Assert-Link $script:InstExe '安装版'
    Assert-Aumid $AumidInstalled $InstalledData
    if (Test-Path -LiteralPath (Join-Path $script:InstDir 'data')) {
        Fail ('安装版不该在安装目录里建 data：{0}' -f (Join-Path $script:InstDir 'data'))
    }
    Pass '安装版没有把自己当成绿色版'
    Shot-Main $script:procInst 'installed-running'
}

function Find-InstallDir {
    foreach ($r in 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall',
        'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall',
        'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall') {
        foreach ($k in @(Get-ChildItem -LiteralPath $r -ErrorAction SilentlyContinue)) {
            if ($k.GetValue('DisplayName') -eq $Product) {
                $u = Command-Exe ($k.GetValue('UninstallString'))
                if ($u) { return (Split-Path $u) }
            }
        }
    }
    return $null
}

function Check-Uninstall {
    Start-Check '7 uninstall'
    Stop-Gracefully $script:procInst '安装版'
    Wait-Gone (Join-Path $script:InstDir $CoreName) '安装版的 twcore.exe'
    Pass '安装版和它的网关退出了'

    # 一份绿色版开着开机自启的样子（winreg::autostart_command）
    $run = '"{0}" --autostart' -f $P2exe
    # 新机器上 Run 这个键可能还没有。只在没有时建：对已有的键 `New-Item -Force` 会清空它的值
    if (-not (Test-Path -LiteralPath $RunKey)) { New-Item -Path $RunKey | Out-Null }
    Set-ItemProperty -LiteralPath $RunKey -Name $Product -Value $run
    Say ('开机自启指向 P2：{0}' -f $run)

    # `_?=` 让卸载程序就地运行、等得到它结束（不带的话它把自己拷到 %TEMP% 再起一份，
    # 这个进程马上就退出了）。代价是它删不掉自己和安装目录，那不在检查之内
    $uninstaller = Join-Path $script:InstDir 'uninstall.exe'
    $u = Start-Process -FilePath $uninstaller -ArgumentList ('/S _?={0}' -f $script:InstDir) -PassThru
    $null = $u.Handle
    if (-not $u.WaitForExit(300000)) { Fail '静默卸载 5 分钟没有结束' }
    if ($u.ExitCode -ne 0) { Fail ('静默卸载的退出码是 {0}' -f $u.ExitCode) }
    if (Test-Path -LiteralPath $script:InstExe) { Fail ('卸载之后 {0} 还在' -f $script:InstExe) }
    Pass ('静默卸载结束（退出码 0），安装目录里剩下：{0}' -f (List-Dir $script:InstDir))

    $link = Get-Reg $LinkCommandKey ''
    if (Same (Command-Exe $link) $script:InstExe) { Fail ('指向安装版的链接还在：{0}' -f $link) }
    if ($link) { Warn ('卸载之后 HKCU 里还有链接：{0}' -f $link) }
    Pass '指向安装版的 thinkwatch:// 链接删掉了'
    if (Test-Path -LiteralPath "$AumidRoot\$AumidInstalled") {
        Fail ('{0} 的登记还在：IconUri = {1}' -f $AumidInstalled, (Get-Reg "$AumidRoot\$AumidInstalled" 'IconUri'))
    }
    Pass ('{0} 的通知登记删掉了' -f $AumidInstalled)
    $now = Get-Reg $RunKey $Product
    if ($now -ne $run) { Fail ('指向 P2 的开机自启不该动：现在是 {0}' -f $now) }
    Pass ('指向 P2 的开机自启原样留着：{0}' -f $now)
    if (-not (Test-Path -LiteralPath $InstalledData)) { Fail ('静默卸载不该删 {0}' -f $InstalledData) }
    Pass ('{0} 还在：{1}' -f $InstalledData, (List-Dir $InstalledData))

    # 和用户退出程序之后再清理一样：P2 的 WebView2 子进程也走了。还占着 `data\webview` 的话
    # 清理会把它留下（见 uninstall::drop_data）
    $p2webview = Join-Path $P2 'data\webview'
    $left = Wait-For { @(Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" | Where-Object { "$($_.CommandLine)".IndexOf($p2webview, [StringComparison]::OrdinalIgnoreCase) -ge 0 }).Count -eq 0 } 30
    if (-not $left) { Warn 'P2 的 WebView2 子进程 30 秒后还在' }

    $cleanup = Start-App $P2exe 'p2-cleanup' @('--uninstall-cleanup', '--delete-data')
    if (-not $cleanup.WaitForExit(120000)) { Fail '--uninstall-cleanup 在 120 秒内没有结束' }
    foreach ($l in (Read-Log (Join-Path $Logs 'e2e-p2-cleanup.out.log'))) { Say ('  ' + $l) }
    if ($cleanup.ExitCode -ne 0) { Fail ('--uninstall-cleanup --delete-data 的退出码是 {0}' -f $cleanup.ExitCode) }
    Pass '--uninstall-cleanup --delete-data 退出码 0'
    $P2data = Join-Path $P2 'data'
    if (Test-Path -LiteralPath $P2data) { Fail ('{0} 还在：{1}' -f $P2data, (List-Dir $P2data)) }
    Pass ('{0} 删掉了' -f $P2data)
    $refs = Find-RegRefs $P2
    if ($refs.Count -gt 0) { Fail ('HKCU 里还有指向 P2 的项：{0}' -f ($refs -join ' | ')) }
    Pass 'HKCU 里没有指向 P2 的项了（链接、开机自启、通知登记）'
}

# ==== 跑 ====

$failure = $null
try {
    Check-Prerequisites
    Check-PortableStart
    Check-Switch
    Check-Cancel
    Check-SameExe
    Check-NotWritable
    Check-Installed
    Check-Uninstall
} catch {
    $failure = $_.Exception.Message
    $script:Results.Add([pscustomobject]@{ Check = $script:Check; Result = 'FAIL'; What = $failure })
    Say ''
    Say ('FAIL [{0}] {1}' -f $script:Check, $failure)
    Say $_.ScriptStackTrace
    Shot 'failure'
    Dump-State
} finally {
    Stop-Leftovers
}

$appWarnings = Show-AppWarnings
Write-Summary $failure $appWarnings
Say ''
Say ('{0} 项通过，{1} 条提醒' -f @($script:Results | Where-Object { $_.Result -eq 'pass' }).Count, $script:Warnings.Count)
if ($failure) {
    $one = ($failure -replace '%', '%25' -replace "`r", '%0D' -replace "`n", '%0A')
    Write-Host ('::error title=Windows end-to-end::[{0}] {1}' -f $script:Check, $one)
    exit 1
}
exit 0

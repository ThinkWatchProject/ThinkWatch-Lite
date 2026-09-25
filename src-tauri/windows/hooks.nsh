; 安装、卸载时额外做的事。由 tauri.windows.conf.json 的 `installerHooks` 接进
; Tauri 生成的 NSIS 脚本。
;
; 防火墙里放行 WSL 的那条规则。WSL2 默认用 NAT 网络，WSL 里的客户端要经由 WSL
; 虚拟网卡连到 Windows 上的网关，这是一次进入 Windows 的入站连接，由 Windows
; Defender 防火墙决定放不放行（Hyper-V 防火墙管的是进出 WSL 虚拟机的流量，
; WSL 连 Windows 对它来说是出站，默认放行）。
;
; - 只放行网关进程（按程序路径），只放行 TCP，只放行来自 172.16.0.0/12 —— WSL
;   的 NAT 从这个网段里挑地址，core 默认的放行名单里也是它；
; - 三种网络位置都生效：WSL 的虚拟网卡被归为「公用网络」；
; - 安装程序本来就以管理员身份运行（perMachine）。加不上也不拦安装：客户端页
;   发现规则缺失时，会给出等价的 PowerShell 命令。
;
; 名字和网段要和 tw_adopt::wsl::{FIREWALL_RULE, NAT_RANGE} 一致，
; src-tauri/src/clients/wsl.rs 里有一条测试核对。

!define TW_WSL_RULE "ThinkWatch Lite (WSL)"
!define TW_WSL_RANGE "172.16.0.0/12"

!macro NSIS_HOOK_POSTINSTALL
  ; 先删同名的：重装、自动更新都会走到这里，不删就攒下好几条一样的
  nsExec::Exec 'netsh advfirewall firewall delete rule name="${TW_WSL_RULE}"'
  Pop $0
  nsExec::Exec 'netsh advfirewall firewall add rule name="${TW_WSL_RULE}" dir=in action=allow protocol=TCP program="$INSTDIR\twcore.exe" remoteip=${TW_WSL_RANGE} profile=any enable=yes'
  Pop $0
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  nsExec::Exec 'netsh advfirewall firewall delete rule name="${TW_WSL_RULE}"'
  Pop $0
!macroend

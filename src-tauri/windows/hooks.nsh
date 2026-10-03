; 安装版的卸载程序钩子。Tauri 的 NSIS 模板（以 Tauri CLI 2.11.4 的 installer.nsi 为准）
; 在 `Section Uninstall` 的第一行插入 NSIS_HOOK_PREUNINSTALL，那时还一个文件都没删；
; NSIS_HOOK_POSTUNINSTALL 在这一节的最后，文件、注册项都已经删完。
;
; 卸载之前先做应用内「卸载」那几步：还原接管过的客户端（含 WSL 里的）、删掉指向这个
; 程序的注册项，勾了「同时删除数据」再删数据目录。这些事只有应用自己知道怎么做，交给
; 同一个 exe 的无界面模式 `--uninstall-cleanup`（src-tauri/src/cleanup.rs），等它做完。
;
; 用到的几样都是模板里的：`$UpdateMode`、`$PassiveMode`（.onInit / un.onInit 里按 /UPDATE、
; /P 设好）、`$DeleteAppDataCheckboxState`（确认页那个勾选框，离开确认页时读）、
; `CheckIfAppIsRunning`（utils.nsh）、`MAINBINARYNAME` / `PRODUCTNAME`。宏体在插入的地方才
; 展开，那时它们都已经声明过了。

; 开机自启那一项，指向的不是这个安装目录时，卸载前的原值（见下面两个钩子）
Var TWKeptAutostart

!macro NSIS_HOOK_PREUNINSTALL
  StrCpy $TWKeptAutostart ""
  ; 自更新也走一遍卸载（/UPDATE）：接管、注册项、数据都要留给新装上的那一版
  ${If} $UpdateMode <> 1
    ; 先关掉正在运行的程序：开着的时候它的 core 占着数据目录，它自己也会在启动时把
    ; 注册项改回指向自己。用户在提示框里取消就整个不卸载。模板紧接着会再查一次，
    ; 那时已经没有在运行的了（两次插入的标签带着各自的行号，不会重名）
    !insertmacro CheckIfAppIsRunning "${MAINBINARYNAME}.exe" "${PRODUCTNAME}"
    ${If} $DeleteAppDataCheckboxState = 1
      ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --uninstall-cleanup --delete-data'
    ${Else}
      ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --uninstall-cleanup'
    ${EndIf}

    ; **模板随后不论指向哪里都删开机自启那一项**（HKCU\…\Run 里值名是产品名的那个）。
    ; 全机只有这一项，安装版和绿色版共用：它指向的是另一份（绿色版）时，那是那一份的
    ; 设置，卸载这一份不该动它。上面的清理只删指向这个 exe 的；这里记下指向别处的原值，
    ; 删完再写回去。比较不分大小写（`!=` 是 StrCmp），带不带引号都认
    ReadRegStr $R0 HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCTNAME}"
    ${If} $R0 != ""
      StrCpy $R1 "$INSTDIR\"
      StrLen $R2 $R1
      StrCpy $R3 $R0 $R2
      StrCpy $R4 $R0 $R2 1
      ${If} $R3 != $R1
      ${AndIf} $R4 != $R1
        StrCpy $TWKeptAutostart $R0
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; 写回上面记下的、指向另一份的开机自启（「启动应用」里的开关模板不碰，原样留着）
  ${If} $TWKeptAutostart != ""
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCTNAME}" $TWKeptAutostart
  ${EndIf}
!macroend

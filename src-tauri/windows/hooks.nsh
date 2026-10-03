; 安装版的卸载程序钩子。Tauri 的 NSIS 模板（以 Tauri CLI 2.11.4 的 installer.nsi 为准）
; 在 `Section Uninstall` 的第一行插入 NSIS_HOOK_PREUNINSTALL，那时还一个文件都没删。
;
; 卸载之前先做应用内「卸载」那几步：还原接管过的客户端（含 WSL 里的）、删掉指向这个
; 程序的注册项，勾了「同时删除数据」再删数据目录。这些事只有应用自己知道怎么做，交给
; 同一个 exe 的无界面模式 `--uninstall-cleanup`（src-tauri/src/cleanup.rs），等它做完。
;
; 用到的几样都是模板里的：`$UpdateMode`、`$PassiveMode`（.onInit / un.onInit 里按 /UPDATE、
; /P 设好）、`$DeleteAppDataCheckboxState`（确认页那个勾选框，离开确认页时读）、
; `CheckIfAppIsRunning`（utils.nsh）、`MAINBINARYNAME` / `PRODUCTNAME`。宏体在插入的地方才
; 展开，那时它们都已经声明过了。

!macro NSIS_HOOK_PREUNINSTALL
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
  ${EndIf}
!macroend

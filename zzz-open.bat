@echo off
setlocal EnableDelayedExpansion
title ZZZ Calculator - Vite Preview

REM ==================================================================
REM ZZZ Calculator 一键启动脚本
REM
REM 用法：把此 .bat 复制到桌面（C:\Users\<你>\Desktop\zzz-open.bat），双击即可。
REM
REM 流程（全部在 WSL 内执行，无需你手输任何命令）：
REM   1. 自动定位 zzz-calculator 项目目录
REM   2. 首次运行自动 npm install
REM   3. 执行 npm run preview（默认 http://127.0.0.1:4173）
REM
REM 退出方式：Ctrl+C 或关闭窗口
REM
REM 如需指定项目路径，取消下面一行的注释并填入完整 WSL 路径：
REM   set ZZZ_PATH=/mnt/c/Users/<你>/Projects/zzz-calculator
REM ==================================================================

set ZZZ_PATH=
set INSTALL_FLAG=%~dp0zzz-install-done.txt

if not defined USERPROFILE (
    echo [错误] USERPROFILE 未设置
    pause & exit /b 1
)

echo.
echo ==================================================================
echo    ZZZ Calculator - Vite Preview Server
echo ==================================================================
echo.
echo [1/4] 检测 WSL ...

where wsl >nul 2>&1
if errorlevel 1 (
    echo [错误] 找不到 wsl 命令。
    echo   请以管理员身份运行 PowerShell: wsl --install
    pause & exit /b 1
)

wsl -l -q >nul 2>&1
if errorlevel 1 (
    echo [错误] 未检测到已安装的 WSL 发行版。
    echo   请以管理员身份运行 PowerShell: wsl --install
    pause & exit /b 1
)
echo [1/4] OK  WSL 就绪

echo.
echo [2/4] 检查 WSL 内 Node.js / npm ...

set WSL_DISTRO_FOR_INNER=%WSL_DISTRO%

for /f "delims=" %%a in ('wsl -e bash -lc "echo ok"') do set WSL_TEST=%%a
if "%WSL_TEST%" neq "ok" (
    echo [错误] WSL 无法启动
    pause & exit /b 1
)

for /f "delims=" %%a in ('wsl -e bash -lc "command -v node 2>/dev/null || echo MISSING"') do set NODE_BIN=%%a
for /f "delims=" %%a in ('wsl -e bash -lc "command -v npm 2>/dev/null || echo MISSING"') do set NPM_BIN=%%a

if "%NODE_BIN%"=="MISSING" (
    echo [错误] WSL 内找不到 node，请先在 WSL 里安装 Node.js
    pause & exit /b 1
)
if "%NPM_BIN%"=="MISSING" (
    echo [错误] WSL 内找不到 npm
    pause & exit /b 1
)
echo [2/4] OK  Node.js / npm 就绪

echo.
echo [3/4] 定位项目目录 ...

if not "%ZZZ_PATH%"=="" (
    echo      使用指定路径: %ZZZ_PATH%
) else (
    for /f "delims=" %%a in ('wsl -e bash -lc "for d in ~/projects ~/ ~/Desktop /tmp; do [ -d ${d}/zzz-calculator ] && echo ${d}/zzz-calculator && break; done"') do set ZZZ_PATH=%%a
    if not defined ZZZ_PATH (
        echo [错误] 未找到 zzz-calculator 项目。
        echo   已搜索：~/projects  ~/  ~/Desktop  /tmp
        echo   请在 WSL 中将项目放到这些路径之一，
        echo   或在此脚本顶部 ZZZ_PATH 变量中手动填写路径。
        pause & exit /b 1
    )
    echo      项目位置：%ZZZ_PATH%
)

echo.
echo [4/4] 准备启动 ...

if not exist "%INSTALL_FLAG%" (
    echo      首次运行，执行 npm install ...
    wsl -e bash -lc "cd %ZZZ_PATH% && npm install"
    if errorlevel 1 (
        echo [错误] npm install 失败，请先在 WSL 内手动 cd 到项目并运行 npm install
        pause & exit /b 1
    )
    echo ok > "%INSTALL_FLAG%"
    echo      ✓ 依赖安装完成
) else (
    echo      依赖已就绪，跳过 install
)

echo.
echo ==================================================================
echo    启动 vite preview ...
echo    浏览器将在几秒后自动打开 http://127.0.0.1:4173
echo    退出方式：Ctrl+C 或关闭此窗口
echo ==================================================================
echo.

REM 等待 5 秒让 vite 服务启动，同时打开浏览器
start "" http://127.0.0.1:4173/
ping -n 6 127.0.0.1 >nul

echo      服务启动中，按 Ctrl+C 停止...
echo.

wsl -e bash -lc "cd %ZZZ_PATH% ^&^& npm run preview"

:done
endlocal

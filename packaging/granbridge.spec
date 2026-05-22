# PyInstaller spec — onedir build of granbridge.exe (self-serving bridge + UI)
from PyInstaller.utils.hooks import collect_all, collect_submodules

datas = [("../ui/dist", "ui_dist"), ("../src/granbridge/overlay", "overlay")]
binaries = []
hiddenimports = []
for pkg in ("bleak", "winrt", "winrt_runtime", "websockets", "pydantic", "pydantic_settings",
            "structlog", "typer", "click", "aiomqtt", "httpx"):
    try:
        d, b, h = collect_all(pkg)
        datas += d; binaries += b; hiddenimports += h
    except Exception:
        pass
hiddenimports += collect_submodules("winrt")

a = Analysis(
    ["granbridge_entry.py"],
    pathex=["../src"],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name="granbridge", console=True)
coll = COLLECT(exe, a.binaries, a.datas, name="granbridge")

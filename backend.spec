# -*- mode: python ; coding: utf-8 -*-


import os
import sys

bin_files = []
suffix = ".exe" if sys.platform == "win32" else ""
for b in ["ffmpeg", "ffprobe"]:
    src_path = os.path.join("bin", f"{b}{suffix}")
    if os.path.exists(src_path):
        bin_files.append((src_path, "bin"))

a = Analysis(
    ['web/server.py'],
    pathex=[],
    binaries=[],
    datas=bin_files,
    hiddenimports=['tzdata'],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        'tensorboard',
        'matplotlib',
        'ipython',
        'scipy',
        'unittest',
        'numpy.tests',
        'numba.tests',
        'sympy.testing'
    ],
    noarchive=False,
    optimize=1,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='backend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

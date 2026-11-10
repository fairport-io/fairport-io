# Desktop automation (X display :1)

All screen work = run the script below inline via heredoc, one command per invocation: replace `shot` with any subcommand + args (usage documented in its docstring). E.g. to click: `cat <<'EOPY' | python3 - click 195 417`. No files need to be created or persisted.

Keep this file generic: never write machine-specific state into it — no resolutions, window positions or layouts, open apps/tabs/documents/threads, users, or any other session details. It must stay valid unchanged on any of many machines; only record rules and techniques that hold anywhere.

Screenshot & working-file hygiene: take every screenshot into one fixed file by calling bare `shot` (overwrites `/tmp/screen.png`) — never create new paths like `shot2.png`. Same for any derived files you make (crops, zooms, extracted images/text): reuse ONE fixed path (e.g. `/tmp/crop.png`) and overwrite it with whatever you're working on each time — don't spawn per-step names (`crop1.png`, `crop2.png`, …). This host's disk space is precious: never accumulate artifacts; always overwrite the same file.

Reading fine text: full-screen screenshots often get downscaled when read back, so small UI/web fonts are hard to transcribe reliably. To read them, crop just the needed region and upscale it (~2x, `Image.LANCZOS`) with PIL into one fixed working file (default `/tmp/crop.png`, overwritten each time), then `read` that file.

Workflow: fresh screenshot → find target pixels in that image (never assume layout, resolution, or window positions — they can change) → act → wait a moment → re-screenshot and verify the expected state before moving on. `type`/`key` go to whatever is focused — check focus first. observe_ui / find_roots / act_ui don't work here (empty, outline-only states); skip them. To scroll a web page: click inside its content area first (so it has focus), then `key Page_Down` / `Page_Up`; re-screenshot to confirm the new position before acting.

Shell gotcha: `DISPLAY=:1 cmd` is only valid as a prefix on simple commands — never write `DISPLAY=:1 for w in ...; done`; bash rejects the whole line at parse time (rc 2). Use `export DISPLAY=:1` first or attach the prefix to each command individually. Heredoc gotcha: when retyping this script inline, argparse's `--repeat` maps to dest `a.repeat` (not `a.repeats`) — a mismatch crashes in `main()` with an AttributeError.

```bash
cat <<'EOPY' | python3 - shot
#!/usr/bin/env python3
"""Desktop control for X display :1 — screenshot + click/type via xdotool.

Run inline:  cat <<'EOPY' | python3 - <subcommand> [args]   (heredoc body = this script)

Subcommands:
  shot [PATH]                     save screenshot, print "<path> WxH" (default /tmp/screen.png)
  click X Y [--button N] [--repeat N]    mouse button: 1=left, 2=middle, 3=right
  type TEXT [--delay MS]          types into the focused window
  key K1 [K2 ...]                 e.g. Return, ctrl+c alt+Tab
  find [NAME] [--class CLASS]     list matching windows as "id<TAB>name"
"""
import argparse
import os
import subprocess

from PIL import ImageGrab

DISPLAY = ":1"


def _env():
    return {**os.environ, "DISPLAY": DISPLAY}


def shot(path="/tmp/screen.png"):
    im = ImageGrab.grab(xdisplay=DISPLAY)
    im.save(path)
    print(f"{path} {im.size[0]}x{im.size[1]}")
    return path


def _xdotool(*args, capture=False):
    r = subprocess.run(["xdotool", *map(str, args)], env=_env(),
                       capture_output=capture or None, text=True)
    if r.returncode not in (0, 1):  # rc==1: search found no windows
        raise RuntimeError(f"xdotool {' '.join(map(str, args))}: {r.stderr.strip()}")
    return r.stdout if capture else None


def click(x, y, button=1, repeats=1):
    _xdotool("mousemove", x, y, "click", "--repeat", repeats, button)


def type_text(text, delay_ms=20):
    _xdotool("type", "--delay", delay_ms, text)


def key(*keys):
    _xdotool("key", *keys)


def find(name=None, cls=None):
    args = ["search"]
    if name:
        args += ["--name", name]
    if cls:
        args += ["--class", cls]
    if not name and not cls:
        raise ValueError("give a name and/or class")
    out = _xdotool(*args, capture=True) or ""
    for wid in out.split():
        try:
            title = _xdotool("getwindowname", wid, capture=True).strip()
        except RuntimeError:
            title = "?"
        print(f"{wid}\t{title}")


def main():
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("shot")
    s.add_argument("path", nargs="?", default="/tmp/screen.png")

    c = sub.add_parser("click")
    c.add_argument("x", type=int)
    c.add_argument("y", type=int)
    c.add_argument("--button", type=int, default=1)
    c.add_argument("--repeat", type=int, default=1)

    t = sub.add_parser("type")
    t.add_argument("text")
    t.add_argument("--delay", type=int, default=20)

    k = sub.add_parser("key")
    k.add_argument("keys", nargs="+")

    f = sub.add_parser("find")
    f.add_argument("name", nargs="?")
    f.add_argument("--class", dest="cls")

    a = p.parse_args()
    if a.cmd == "shot":
        shot(a.path)
    elif a.cmd == "click":
        click(a.x, a.y, button=a.button, repeats=a.repeat)
    elif a.cmd == "type":
        type_text(a.text, delay_ms=a.delay)
    elif a.cmd == "key":
        key(*a.keys)
    elif a.cmd == "find":
        find(a.name, cls=a.cls)


main()
EOPY
```

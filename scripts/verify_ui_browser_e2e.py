from __future__ import annotations

import os
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PORT = 18349
ORIGIN = f"http://127.0.0.1:{PORT}"


def wait_ready(process: subprocess.Popen, log_file, attempts: int = 120) -> None:
    for _ in range(attempts):
        if process.poll() is not None:
            log_file.flush()
            log_file.seek(0)
            raise RuntimeError(f"offline server exited early:\n{log_file.read()}")
        try:
            with urllib.request.urlopen(ORIGIN, timeout=2) as response:
                if response.status == 200:
                    return
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            pass
        time.sleep(0.25)
    log_file.flush()
    log_file.seek(0)
    raise RuntimeError(f"offline server readiness timed out:\n{log_file.read()}")


def start_server(sqlite_path: Path, log_file):
    env = os.environ.copy()
    env.update({
        "PORT": str(PORT),
        "BLUEWOLF_STORAGE": "sqlite",
        "BLUEWOLF_SQLITE_PATH": str(sqlite_path),
        "NEXT_TELEMETRY_DISABLED": "1",
    })
    process = subprocess.Popen(
        ["node", "scripts/start-offline.mjs"],
        cwd=ROOT,
        env=env,
        stdout=log_file,
        stderr=subprocess.STDOUT,
        text=True,
    )
    wait_ready(process, log_file)
    return process


def stop_server(process: subprocess.Popen | None) -> None:
    if process is None or process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def assert_no_page_overflow(page: Page, label: str) -> None:
    metrics = page.evaluate(
        """() => ({
            scrollWidth: document.documentElement.scrollWidth,
            clientWidth: document.documentElement.clientWidth,
            bodyScrollWidth: document.body.scrollWidth,
            bodyClientWidth: document.body.clientWidth,
        })"""
    )
    assert metrics["scrollWidth"] <= metrics["clientWidth"] + 1, (
        f"{label}: document horizontally overflows viewport: {metrics}"
    )
    assert metrics["bodyScrollWidth"] <= metrics["bodyClientWidth"] + 1, (
        f"{label}: body horizontally overflows viewport: {metrics}"
    )


def assert_svg_text_has_no_stroke(page: Page, label: str) -> None:
    offenders = page.evaluate(
        """() => [...document.querySelectorAll('svg text')]
          .filter((element) => {
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            if (rect.width <= 0 || rect.height <= 0 || style.visibility === 'hidden' || style.display === 'none') return false;
            const stroke = style.stroke;
            const opacity = Number.parseFloat(style.strokeOpacity || '1');
            return stroke && stroke !== 'none' && stroke !== 'transparent' && !stroke.includes('0, 0, 0, 0') && opacity > 0;
          })
          .map((element) => ({ text: element.textContent, stroke: getComputedStyle(element).stroke }))"""
    )
    assert not offenders, f"{label}: visible SVG text inherits a stroke: {offenders}"


def assert_local_hebrew_canvas(page: Page) -> None:
    result = page.evaluate(
        """async () => {
          await document.fonts.ready;
          const canvas = document.createElement('canvas');
          canvas.width = 700;
          canvas.height = 180;
          const ctx = canvas.getContext('2d');
          if (!ctx) return { ok: false, reason: 'no-2d-context' };
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.fillStyle = '#102433';
          ctx.font = '700 46px Arial, "Noto Sans Hebrew", sans-serif';
          ctx.direction = 'rtl';
          ctx.textAlign = 'right';
          ctx.fillText('זאב כחול — דוח תחקור הנדסי', 650, 105);
          const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          let nonWhite = 0;
          for (let i = 0; i < pixels.length; i += 4) {
            if (pixels[i] < 245 || pixels[i + 1] < 245 || pixels[i + 2] < 245) nonWhite += 1;
          }
          const jpeg = canvas.toDataURL('image/jpeg', 0.94);
          return {
            ok: true,
            direction: ctx.direction,
            nonWhite,
            jpegPrefix: jpeg.slice(0, 23),
            width: ctx.measureText('זאב כחול — דוח תחקור הנדסי').width,
          };
        }"""
    )
    assert result.get("ok"), f"REP-01: local Hebrew canvas could not initialize: {result}"
    assert result["direction"] == "rtl", f"REP-01: canvas direction is not RTL: {result}"
    assert result["nonWhite"] > 500, f"REP-01: Hebrew canvas did not render enough visible glyph pixels: {result}"
    assert result["width"] > 100, f"REP-01: Hebrew canvas text width is unexpectedly small: {result}"
    assert result["jpegPrefix"].startswith("data:image/jpeg;base64,"), f"REP-01: canvas did not encode a local JPEG page: {result}"


def open_operator(page: Page) -> None:
    page.goto(ORIGIN, wait_until="domcontentloaded")
    operator_tab = page.get_by_role("tab", name="מפעיל")
    if operator_tab.count():
        operator_tab.click()
    page.get_by_role("button", name="החלפה").first.wait_for(state="visible", timeout=30000)


def verify_viewport(page: Page, *, width: int, height: int, label: str) -> None:
    page.set_viewport_size({"width": width, "height": height})
    open_operator(page)
    assert_no_page_overflow(page, f"{label}/operator")
    assert_svg_text_has_no_stroke(page, f"{label}/operator")

    page.get_by_role("button", name="החלפה").first.click()
    dialog = page.locator(".v04-template-dialog")
    dialog.wait_for(state="visible", timeout=10000)
    page.get_by_text("החלפת תבנית", exact=False).first.wait_for(state="visible")

    box = dialog.bounding_box()
    assert box, f"{label}: template dialog has no bounding box"
    tolerance = 2
    assert box["x"] >= -tolerance, f"{label}: dialog escapes left viewport edge: {box}"
    assert box["x"] + box["width"] <= width + tolerance, f"{label}: dialog escapes right viewport edge: {box}"
    assert box["width"] <= width + tolerance, f"{label}: dialog is wider than viewport: {box}"

    dialog_text = dialog.inner_text()
    assert "החלפת תבנית" in dialog_text, f"{label}: Hebrew dialog heading is missing"
    assert "SI" in dialog_text or "SO" in dialog_text, f"{label}: template family label is missing"

    assert_no_page_overflow(page, f"{label}/dialog")
    assert_svg_text_has_no_stroke(page, f"{label}/dialog")

    page.keyboard.press("Escape")
    dialog.wait_for(state="hidden", timeout=5000)


def run_browser_regression() -> None:
    with tempfile.TemporaryDirectory(prefix="bluewolf-ui-e2e-") as directory:
        sqlite_path = Path(directory) / "workspace.sqlite"
        log_path = Path(directory) / "offline.log"
        process = None
        with log_path.open("w+", encoding="utf-8") as log_file:
            try:
                process = start_server(sqlite_path, log_file)
                with sync_playwright() as playwright:
                    browser = playwright.chromium.launch(headless=True)
                    context = browser.new_context(viewport={"width": 1440, "height": 900})
                    page = context.new_page()
                    verify_viewport(page, width=1440, height=900, label="desktop")
                    assert_local_hebrew_canvas(page)
                    verify_viewport(page, width=390, height=844, label="mobile-390")
                    browser.close()
                print("PASS UI-01 + REP-01 canvas: desktop/mobile operator and template dialog have no page overflow; SVG text has no stroke; offline Chromium renders RTL Hebrew to a local JPEG page")
            except Exception:
                log_file.flush()
                log_file.seek(0)
                print("--- offline server log ---")
                print(log_file.read())
                raise
            finally:
                stop_server(process)


if __name__ == "__main__":
    run_browser_regression()

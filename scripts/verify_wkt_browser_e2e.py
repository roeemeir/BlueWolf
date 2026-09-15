from __future__ import annotations

import json
import os
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PORT = 18348
ORIGIN = f"http://127.0.0.1:{PORT}"
WORKSPACE_ID = "bw-wkt-browser-e2e"
INITIAL_WKT = "LINESTRING (34.800000 32.000000, 34.810000 32.000000, 34.810000 32.010000, 34.800000 32.000000)"
EDITED_WKT = "LINESTRING (34.820000 32.020000, 34.830000 32.020000, 34.830000 32.030000, 34.820000 32.020000)"


def request(path: str, *, method: str = "GET", payload: object | None = None):
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    headers = {"x-bluewolf-workspace": WORKSPACE_ID}
    if data is not None:
        headers["content-type"] = "application/json"
    req = urllib.request.Request(ORIGIN + path, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=3) as response:
        return response.status, json.loads(response.read().decode("utf-8"))


def wait_ready(process: subprocess.Popen, log_file, attempts: int = 120):
    for _ in range(attempts):
        if process.poll() is not None:
            log_file.flush()
            log_file.seek(0)
            raise RuntimeError(f"offline server exited early:\n{log_file.read()}")
        try:
            status, _ = request("/api/workspace")
            if status == 200:
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


def stop_server(process: subprocess.Popen | None):
    if process is None or process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def seed_workspace():
    state = {
        "routes": [{
            "id": "route-e2e",
            "name": "E2E WKT",
            "arena": "E2E",
            "vehicleType": "default",
            "family": "SI",
            "geometry": INITIAL_WKT,
            "updatedAt": "2026-09-15T00:00:00.000Z",
            "routeKind": "compact",
        }],
        "templates": [],
        "gtSegments": [],
    }
    status, payload = request(
        "/api/workspace",
        method="PUT",
        payload={
            "state": state,
            "expectedRevision": 0,
            "category": "routes",
            "action": "seed-wkt-browser-e2e",
            "detail": "BW-QA-003 browser regression seed",
        },
    )
    assert status == 200, payload
    assert payload.get("revision") == 1, payload


def open_workbench(page):
    page.goto(ORIGIN, wait_until="networkidle")
    page.get_by_role("tab", name="מפתחים").click()
    page.get_by_test_id("route-wkt-workbench").wait_for(state="visible")
    page.get_by_test_id("route-wkt-input").wait_for(state="visible")


def save_wkt(page):
    with page.expect_response(
        lambda response: response.url.endswith("/api/workspace")
        and response.request.method == "PUT"
    ) as response_info:
        page.get_by_test_id("route-wkt-save").click()
    response = response_info.value
    assert response.status == 200, f"workspace save returned {response.status}"


def route_client_point(page, route_id: str):
    hit = page.get_by_test_id(f"route-wkt-hit-{route_id}")
    hit.scroll_into_view_if_needed()
    point = hit.evaluate(
        """path => {
          const length = path.getTotalLength();
          if (!Number.isFinite(length) || length <= 0) return null;
          const local = path.getPointAtLength(length * 0.35);
          const matrix = path.getScreenCTM();
          if (!matrix) return null;
          const client = new DOMPoint(local.x, local.y).matrixTransform(matrix);
          return { x: client.x, y: client.y };
        }"""
    )
    assert point and isinstance(point.get("x"), (int, float)) and isinstance(point.get("y"), (int, float)), (
        "WKT path has no usable client-space point"
    )
    return point


def run_browser_regression():
    with tempfile.TemporaryDirectory(prefix="bluewolf-wkt-e2e-") as directory:
        sqlite_path = Path(directory) / "workspace.sqlite"
        log_path = Path(directory) / "offline.log"
        process = None
        with log_path.open("w+", encoding="utf-8") as log_file:
            try:
                process = start_server(sqlite_path, log_file)
                seed_workspace()

                with sync_playwright() as playwright:
                    browser = playwright.chromium.launch(headless=True)
                    context = browser.new_context(viewport={"width": 1440, "height": 1000})
                    context.add_init_script(
                        f"window.localStorage.setItem('bluewolf-workspace-id', {json.dumps(WORKSPACE_ID)});"
                    )
                    page = context.new_page()
                    open_workbench(page)

                    input_box = page.get_by_test_id("route-wkt-input")
                    input_box.fill(EDITED_WKT)
                    save_wkt(page)
                    text_saved = input_box.input_value()
                    assert "34.82" in text_saved and "32.02" in text_saved, text_saved

                    start = route_client_point(page, "route-e2e")
                    page.mouse.move(start["x"], start["y"])
                    page.mouse.down()
                    page.mouse.move(start["x"] + 55, start["y"] + 35, steps=8)
                    page.mouse.up()
                    page.wait_for_function(
                        "([selector, before]) => document.querySelector(selector)?.value !== before",
                        arg=["[data-testid='route-wkt-input']", text_saved],
                    )
                    dragged_wkt = input_box.input_value()
                    assert dragged_wkt != text_saved, "browser drag did not change WGS84 WKT"
                    assert dragged_wkt.startswith("LINESTRING"), dragged_wkt
                    save_wkt(page)
                    persisted_after_drag = input_box.input_value()

                    page.reload(wait_until="networkidle")
                    page.get_by_role("tab", name="מפתחים").click()
                    page.get_by_test_id("route-wkt-input").wait_for(state="visible")
                    assert page.get_by_test_id("route-wkt-input").input_value() == persisted_after_drag

                    stop_server(process)
                    process = None
                    process = start_server(sqlite_path, log_file)
                    page.reload(wait_until="networkidle")
                    page.get_by_role("tab", name="מפתחים").click()
                    page.get_by_test_id("route-wkt-input").wait_for(state="visible")
                    restored_wkt = page.get_by_test_id("route-wkt-input").input_value()
                    assert restored_wkt == persisted_after_drag, (
                        "WKT changed across offline process restart:\n"
                        f"expected {persisted_after_drag}\nactual   {restored_wkt}"
                    )

                    status, stored = request("/api/workspace")
                    assert status == 200
                    stored_route = stored["state"]["routes"][0]
                    assert stored_route["geometry"] == persisted_after_drag
                    assert stored.get("revision", 0) >= 3
                    browser.close()

                print("PASS BW-QA-003: text edit -> save -> browser drag -> save -> refresh -> offline process restart preserves identical WGS84 geometry")
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

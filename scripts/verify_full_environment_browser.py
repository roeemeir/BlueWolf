from __future__ import annotations

import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

ORIGIN = os.environ["BLUEWOLF_BROWSER_ORIGIN"].rstrip("/")
CONFIG = Path(os.environ["BLUEWOLF_OPERATIONAL_CONFIG"])
QA_USER = os.environ.get("BLUEWOLF_QA_USER", "")
QA_PASS = os.environ.get("BLUEWOLF_QA_PASS", "")


def coherent(payload: dict, server_id: int) -> None:
    assert payload.get("schemaVersion") == "bluewolf.live-runtime.v1"
    assert str(payload.get("serverId")) == str(server_id)
    source = payload.get("source") or {}
    assert source.get("kind") == "python-core"
    assert source.get("health") == "healthy"
    assert source.get("syntheticNavigation") is not True
    groups = payload.get("groupList") or list((payload.get("groups") or {}).values())
    assert groups, f"server {server_id}: no groups"
    ok = False
    for group in groups:
        members = group.get("members") or []
        routes = group.get("detectedRoutes") or []
        event = group.get("event") or {}
        if (
            group.get("scoreValid") is True
            and isinstance(group.get("rawTotal"), (int, float))
            and event.get("id")
            and any(len(route.get("centerline") or []) >= 3 for route in routes)
            and any(
                member.get("scoreValid") is True
                and isinstance(member.get("latitude"), (int, float))
                and isinstance(member.get("longitude"), (int, float))
                for member in members
            )
        ):
            ok = True
            break
    assert ok, f"server {server_id}: no same-group score/GPS/route/event evidence"


def no_overflow(page, label: str) -> None:
    metrics = page.evaluate("""() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      bodyScrollWidth: document.body.scrollWidth,
      bodyClientWidth: document.body.clientWidth,
    })""")
    assert metrics["scrollWidth"] <= metrics["clientWidth"] + 1, f"{label}: document overflow {metrics}"
    assert metrics["bodyScrollWidth"] <= metrics["bodyClientWidth"] + 1, f"{label}: body overflow {metrics}"


def run() -> None:
    cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    server_ids = [int(row["id"]) for row in cfg["servers"]]
    assert len(server_ids) >= 3

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        credentials = {"username": QA_USER, "password": QA_PASS} if QA_USER and QA_PASS else None
        context = browser.new_context(viewport={"width": 1440, "height": 900}, http_credentials=credentials)
        page = context.new_page()
        console_errors: list[str] = []
        page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
        page.goto(ORIGIN, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_load_state("networkidle", timeout=60000)
        assert len(page.locator("body").inner_text().strip()) > 100
        assert page.locator("[data-nextjs-dialog], .vite-error-overlay, #webpack-dev-server-client-overlay").count() == 0

        workspace = page.evaluate("""async () => {
          const r = await fetch('/api/workspace', {cache: 'no-store'});
          return {status: r.status, body: await r.json()};
        }""")
        assert workspace["status"] == 200 and workspace["body"].get("storage") == "sqlite"

        for server_id in server_ids:
            result = page.evaluate("""async (serverId) => {
              const r = await fetch('/api/live-runtime?serverId=' + encodeURIComponent(serverId), {cache: 'no-store'});
              return {status: r.status, body: await r.json()};
            }""", server_id)
            assert result["status"] == 200, f"server {server_id}: Web live-runtime HTTP {result['status']}"
            coherent(result["body"], server_id)

        no_overflow(page, "desktop")
        tab = page.get_by_role("tab", name="תחקור")
        if tab.count():
            tab.click()
            page.locator(".investigation-workspace").wait_for(state="visible", timeout=15000)
            no_overflow(page, "desktop/investigation")

        page.set_viewport_size({"width": 390, "height": 844})
        page.goto(ORIGIN, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_load_state("networkidle", timeout=60000)
        no_overflow(page, "iphone-390")
        operator = page.get_by_role("tab", name="מבצעי")
        if operator.count():
            operator.click()
        switch = page.get_by_role("button", name="החלפה").first
        switch.wait_for(state="visible", timeout=30000)
        switch.click()
        dialog = page.locator(".v04-template-dialog")
        dialog.wait_for(state="visible", timeout=15000)
        box = dialog.bounding_box()
        assert box is not None
        assert box["x"] >= -2 and box["x"] + box["width"] <= 392, f"iPhone dialog outside viewport: {box}"
        page.keyboard.press("Escape")
        no_overflow(page, "iphone-390/operator")

        meaningful_errors = [item for item in console_errors if "favicon" not in item.lower()]
        assert not meaningful_errors, f"browser console errors: {meaningful_errors}"
        browser.close()
    print("PASS full-environment browser: " + ORIGIN + " desktop + iPhone 390x844, SQLite and live Python Core evidence")


if __name__ == "__main__":
    run()

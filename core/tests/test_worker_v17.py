from __future__ import annotations

import base64
import unittest

from bluewolf_core.worker import CoreWorker


class CoreWorkerTests(unittest.TestCase):
    def test_hello_reports_python_contract(self) -> None:
        worker = CoreWorker()
        reply = worker.handle({"command": "hello"})
        self.assertEqual(reply["coreApiVersion"], "1.0.0")
        self.assertEqual(reply["implementationLanguage"], "python")

    def test_create_checkpoint_restore_and_close(self) -> None:
        worker = CoreWorker()
        created = worker.handle({"command": "create_session"})
        session_id = created["sessionId"]

        checkpoint = worker.handle({"command": "checkpoint", "sessionId": session_id})
        raw = base64.b64decode(checkpoint["checkpointBase64"].encode("ascii"), validate=True)
        self.assertIn(b"checkpoint_schema_version", raw)

        restored = worker.handle(
            {
                "command": "restore_session",
                "checkpointBase64": checkpoint["checkpointBase64"],
            }
        )
        self.assertNotEqual(restored["sessionId"], session_id)
        self.assertTrue(worker.handle({"command": "close_session", "sessionId": session_id})["closed"])
        self.assertTrue(
            worker.handle({"command": "close_session", "sessionId": restored["sessionId"]})["closed"]
        )

    def test_process_batch_accepts_wire_navigation_without_ttag(self) -> None:
        worker = CoreWorker()
        session_id = worker.handle({"command": "create_session"})["sessionId"]
        response = worker.handle(
            {
                "command": "process_batch",
                "sessionId": session_id,
                "samples": [
                    {
                        "timestamp": "2026-09-06T18:00:01Z",
                        "serverId": 1,
                        "vehicleId": 101,
                        "active": True,
                        "latitude": 31.7,
                        "longitude": 34.8,
                        "altitude": 10.0,
                        "velocityNorth": 3.0,
                        "velocityEast": 4.0,
                        "reliability": 1.0,
                    }
                ],
                "observedUntilUtc": "2026-09-06T18:00:01Z",
            }
        )
        result = response["result"]
        self.assertEqual(result["processed_until_utc"], "2026-09-06T18:00:01Z")
        self.assertEqual(result["frames"][0]["vehicle_identifier"], 101)


if __name__ == "__main__":
    unittest.main()

#!/usr/bin/env python3
"""Hardware-free checks for the macOS Codex Micro bridge."""

from __future__ import annotations

import importlib.util
import json
import math
import pathlib
import sys
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
BRIDGE_PATH = ROOT / "src" / "hardware" / "codex-micro-bridge.py"
SPEC = importlib.util.spec_from_file_location("codex_micro_bridge", BRIDGE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("could not load Codex Micro bridge")
bridge = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = bridge
SPEC.loader.exec_module(bridge)


def compact(message):
    return json.dumps(message, separators=(",", ":"))


class FramingTests(unittest.TestCase):
    def test_usb_and_bluetooth_framing(self):
        payload = compact({"m": "device.status", "id": 7})
        usb = bridge.frame_message(payload, bridge.TRANSPORT_USB)
        ble = bridge.frame_message(payload, bridge.TRANSPORT_BLE)

        self.assertEqual(len(usb), 1)
        self.assertEqual(len(usb[0]), bridge.REPORT_BYTES_USB)
        self.assertEqual(usb[0][0], bridge.OPCODE_DATA)
        self.assertEqual(len(ble[0]), bridge.REPORT_BYTES_BLE)
        self.assertEqual(ble[0][0], bridge.REPORT_ID)
        self.assertEqual(ble[0][1], bridge.OPCODE_DATA)

    def test_decoder_accepts_prefixed_and_unprefixed_reports(self):
        message = {"m": "v.oai.hid", "p": {"k": "AG00", "act": 1}}
        payload = compact(message)

        usb_decoder = bridge.FrameDecoder()
        self.assertEqual(
            usb_decoder.feed(bridge.frame_message(payload, bridge.TRANSPORT_USB)[0]),
            [message],
        )
        ble_decoder = bridge.FrameDecoder()
        self.assertEqual(
            ble_decoder.feed(bridge.frame_message(payload, bridge.TRANSPORT_BLE)[0]),
            [message],
        )

    def test_decoder_drops_oversized_or_malformed_input(self):
        decoder = bridge.FrameDecoder()
        self.assertEqual(decoder.feed(b"x" * (bridge.REPORT_BYTES_BLE + 1)), [])
        malformed = bytes([bridge.OPCODE_DATA, bridge.MAX_CHUNK_BYTES + 1])
        self.assertEqual(decoder.feed(malformed), [])


class ValidationTests(unittest.TestCase):
    def test_real_keys_are_press_edges_only(self):
        validator = bridge.InputValidator()
        down = {"m": bridge.EVENT_KEY, "p": {"k": "ACT07", "act": 1}}
        up = {"m": bridge.EVENT_KEY, "p": {"k": "ACT07", "act": 0}}

        self.assertEqual(
            validator.decode(down),
            {"kind": "key", "control": "ACT07", "act": 1},
        )
        self.assertIsNone(validator.decode(down))
        self.assertEqual(
            validator.decode(up),
            {"kind": "key", "control": "ACT07", "act": 0},
        )
        self.assertIsNone(validator.decode(up))
        self.assertEqual(
            validator.decode(down),
            {"kind": "key", "control": "ACT07", "act": 1},
        )

    def test_encoder_ticks_accept_any_act(self):
        for act in (None, 0, 1, 2, "firmware-value"):
            validator = bridge.InputValidator()
            message = {"m": bridge.EVENT_KEY, "p": {"k": "ENC_CW", "act": act}}
            self.assertEqual(
                validator.decode(message),
                {"kind": "encoder", "control": "ENC_CW", "act": 1},
            )

    def test_unknown_controls_and_bad_real_key_acts_are_dropped(self):
        validator = bridge.InputValidator()
        for message in (
            {"m": bridge.EVENT_KEY, "p": {"k": "ACT99", "act": 1}},
            {"m": bridge.EVENT_KEY, "p": {"k": "AG00", "act": True}},
            {"m": bridge.EVENT_KEY, "p": {"k": "AG00", "act": 2}},
            {"method": bridge.EVENT_KEY, "m": "different", "params": {}},
        ):
            self.assertIsNone(validator.decode(message))

    def test_joystick_requires_two_finite_unit_numbers(self):
        validator = bridge.InputValidator()
        good = {"method": bridge.EVENT_JOYSTICK, "params": {"a": 0.75, "d": 1}}
        self.assertEqual(
            validator.decode(good),
            {"kind": "joystick", "angle": 0.75, "distance": 1.0},
        )
        for angle, distance in (
            (-0.1, 0.5),
            (1.1, 0.5),
            (0.5, math.inf),
            (True, 0.5),
            ("0.5", 0.5),
        ):
            bad = {"m": bridge.EVENT_JOYSTICK, "p": {"a": angle, "d": distance}}
            self.assertIsNone(validator.decode(bad))

    def test_status_is_allowlisted_and_identity_fields_never_escape(self):
        sanitized = bridge.sanitize_device_status(
            {
                "version": "0.4.1",
                "profile_index": 1,
                "layer_index": 2,
                "battery": 83,
                "is_charging": False,
                "serial": "must-not-escape",
                "location": "must-not-escape",
                "future_secret": "must-not-escape",
            }
        )
        self.assertEqual(
            sanitized,
            {
                "firmwareVersion": "0.4.1",
                "profileIndex": 1,
                "layerIndex": 2,
                "batteryPercent": 83,
                "charging": False,
            },
        )

    def test_watch_records_match_the_typescript_consumer_contract(self):
        self.assertEqual(
            bridge.watch_input_record(
                {"kind": "key", "control": "ACT07", "act": 1}
            ),
            {
                "version": 1,
                "type": "input",
                "input": "ACT07",
                "act": 1,
            },
        )
        self.assertEqual(
            bridge.watch_input_record(
                {"kind": "key", "control": "ACT07", "act": 0}
            ),
            {
                "version": 1,
                "type": "input",
                "input": "ACT07",
                "act": 0,
            },
        )
        self.assertEqual(
            bridge.watch_input_record(
                {"kind": "joystick", "angle": 0.75, "distance": 0.9}
            ),
            {
                "version": 1,
                "type": "joystick",
                "angle": 0.75,
                "distance": 0.9,
            },
        )

    def test_watch_status_matches_the_typescript_consumer_contract(self):
        self.assertEqual(
            bridge._status_record(
                "connected",
                transport=bridge.TRANSPORT_USB,
                device_status={
                    "firmwareVersion": "0.4.1",
                    "batteryPercent": 80,
                    "charging": True,
                },
            ),
            {
                "version": 1,
                "type": "status",
                "state": "connected",
                "transport": "usb",
                "firmware": "0.4.1",
                "battery": 80,
                "charging": True,
            },
        )


if __name__ == "__main__":
    unittest.main()

#!/usr/bin/env python3
"""Hardware-free checks for the macOS Codex Micro bridge."""

from __future__ import annotations

import importlib.util
import json
import math
import pathlib
import sys
import unittest
from unittest import mock


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

    def test_status_request_ids_match_the_sdk_range_and_accept_zero(self):
        device = bridge.Device(object(), bridge.TRANSPORT_USB, own_client_id=1)
        sent_ids = []

        def fake_stream(on_message, seconds=0.0, on_tick=None, tick_interval=0.0):
            self.assertIsNotNone(on_tick)
            on_tick()
            request_id = sent_ids[-1]
            on_message(
                {
                    "id": request_id,
                    "result": {"version": "0.4.1"},
                }
            )

        with mock.patch.object(
            bridge.secrets, "randbelow", side_effect=[0, 998]
        ) as random_id, mock.patch.object(
            device, "_send_status_request", side_effect=sent_ids.append
        ), mock.patch.object(
            device, "stream", side_effect=fake_stream
        ):
            statuses = [device.status_round_trip(), device.status_round_trip()]

        self.assertEqual(random_id.mock_calls, [mock.call(999), mock.call(999)])
        self.assertEqual(sent_ids, [0, 998])
        self.assertEqual(
            statuses,
            [
                {"firmwareVersion": "0.4.1"},
                {"firmwareVersion": "0.4.1"},
            ],
        )

    def test_guarded_status_rechecks_own_queue_after_matching_reply(self):
        device = bridge.Device(object(), bridge.TRANSPORT_USB, own_client_id=1)
        guard_checks = []
        sent_ids = []

        def require_sole_client(require_own_queue=False):
            guard_checks.append(require_own_queue)
            if len(guard_checks) == 2:
                raise bridge.BridgeError("ownership_check_failed")

        def fake_stream(on_message, seconds=0.0, on_tick=None, tick_interval=0.0):
            on_tick()
            on_message({"id": 41, "result": {"version": "0.4.1"}})

        with mock.patch.object(
            bridge.secrets, "randbelow", return_value=41
        ), mock.patch.object(
            device, "require_sole_client", side_effect=require_sole_client
        ), mock.patch.object(
            device, "_send_status_request", side_effect=sent_ids.append
        ), mock.patch.object(
            device, "stream", side_effect=fake_stream
        ):
            with self.assertRaisesRegex(
                bridge.BridgeError, "ownership_check_failed"
            ):
                device.status_round_trip(require_guarded_queue=True)

        self.assertEqual(guard_checks, [True, True])
        self.assertEqual(sent_ids, [41])


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
                "ownership": "guarded",
                "transport": "usb",
                "firmware": "0.4.1",
                "battery": 80,
                "charging": True,
            },
        )

    def test_connected_probe_attests_guard_without_exposing_client_identity(self):
        record = bridge._probe_record(
            "connected",
            transport=bridge.TRANSPORT_USB,
            device_status={"firmwareVersion": "0.4.1"},
        )

        self.assertEqual(record["ownership"], "guarded")
        encoded = json.dumps(record)
        for forbidden in ("pid", "client_count", "registry", "serial", "path"):
            self.assertNotIn(forbidden, encoded.lower())


class OwnershipGuardTests(unittest.TestCase):
    def test_busy_and_permission_failures_never_downgrade_to_shared_input(self):
        self.assertEqual(
            bridge._probe_failure_state("device_busy"),
            ("busy", "another_hid_client"),
        )
        self.assertEqual(
            bridge._watch_failure_state("device_busy"),
            ("busy", "another_hid_client"),
        )
        self.assertEqual(
            bridge._probe_failure_state("permission_denied"),
            ("unavailable", "permission_denied"),
        )
        self.assertEqual(
            bridge._watch_failure_state("permission_denied"),
            ("permission-denied", "Input Monitoring permission is required"),
        )

    def test_event_queue_map_ignores_only_disposed_false_tombstones(self):
        class FakeCoreFoundation:
            dictionary_type = 11
            boolean_type = 22

            def __init__(self, entries, types, boolean_values=None):
                self.entries = entries
                self.types = types
                self.boolean_values = boolean_values or {}

            def CFArrayGetCount(self, _queue):
                return len(self.entries)

            def CFArrayGetValueAtIndex(self, _queue, index):
                return self.entries[index]

            def CFDictionaryGetTypeID(self):
                return self.dictionary_type

            def CFBooleanGetTypeID(self):
                return self.boolean_type

            def CFGetTypeID(self, value):
                return self.types[value]

            def CFBooleanGetValue(self, value):
                return self.boolean_values[value]

        false_only = FakeCoreFoundation([101, 102], {101: 22, 102: 22}, {101: False, 102: False})
        with mock.patch.object(bridge, "_core_foundation", false_only):
            self.assertFalse(bridge._event_queue_has_live_entry(object()))

        sparse_live = FakeCoreFoundation(
            [201, 202, 203],
            {201: 11, 202: 22, 203: 11},
            {202: False},
        )
        with mock.patch.object(bridge, "_core_foundation", sparse_live):
            self.assertTrue(bridge._event_queue_has_live_entry(object()))

    def test_event_queue_map_fails_closed_on_unknown_or_invalid_slots(self):
        class FakeCoreFoundation:
            def __init__(self, entry, entry_type, boolean_value=False):
                self.entry = entry
                self.entry_type = entry_type
                self.boolean_value = boolean_value

            def CFArrayGetCount(self, _queue):
                return 1

            def CFArrayGetValueAtIndex(self, _queue, _index):
                return self.entry

            def CFDictionaryGetTypeID(self):
                return 11

            def CFBooleanGetTypeID(self):
                return 22

            def CFGetTypeID(self, _value):
                return self.entry_type

            def CFBooleanGetValue(self, _value):
                return self.boolean_value

        for fake in (
            FakeCoreFoundation(301, 22, True),
            FakeCoreFoundation(302, 33),
            FakeCoreFoundation(None, 11),
        ):
            with self.subTest(entry=fake.entry, entry_type=fake.entry_type):
                with mock.patch.object(bridge, "_core_foundation", fake):
                    with self.assertRaisesRegex(
                        bridge.BridgeError, "ownership_check_failed"
                    ):
                        bridge._event_queue_has_live_entry(object())

        class OversizedCoreFoundation:
            def CFArrayGetCount(self, _queue):
                return bridge.MAX_EVENT_QUEUE_SLOTS + 1

        with mock.patch.object(
            bridge, "_core_foundation", OversizedCoreFoundation()
        ):
            with self.assertRaisesRegex(
                bridge.BridgeError, "ownership_check_failed"
            ):
                bridge._event_queue_has_live_entry(object())

    def test_direct_client_scan_is_identity_free_and_releases_registry_objects(self):
        class FakeIOKit:
            def __init__(self):
                self.children = [11, 12, 13, 0]
                self.released = []

            def IOHIDDeviceGetService(self, _ref):
                return 7

            def IORegistryEntryGetChildIterator(self, _service, _plane, output):
                output._obj.value = 99
                return 0

            def IOIteratorNext(self, _iterator):
                return self.children.pop(0)

            def IOObjectConformsTo(self, child, class_name):
                if class_name == bridge._IOHID_USER_CLIENT_CLASS:
                    return int(child in (11, 12))
                return 0

            def IORegistryEntryGetRegistryEntryID(self, child, output):
                output._obj.value = child * 100
                return 0

            def IOObjectRelease(self, value):
                self.released.append(value)
                return 0

        fake = FakeIOKit()
        with mock.patch.object(bridge, "_iokit", fake), mock.patch.object(
            bridge, "_core_foundation", object()
        ), mock.patch.object(
            bridge, "is_supported", return_value=True
        ), mock.patch.object(
            bridge,
            "_hid_client_debug_state",
            side_effect=lambda child: (True, child == 11),
        ):
            clients = bridge._direct_hid_user_clients(
                object(), include_debug_state=True
            )

        self.assertEqual(clients, {1100: (True, True), 1200: (True, False)})
        self.assertEqual(fake.released, [11, 12, 13, 99])

    def test_open_device_identifies_only_its_new_registry_client(self):
        class FakeIOKit:
            def __init__(self):
                self.closed = []

            def IOHIDDeviceOpen(self, _ref, _options):
                return 0

            def IOHIDDeviceClose(self, ref, options):
                self.closed.append((ref, options))
                return 0

        class FakeCoreFoundation:
            def __init__(self):
                self.released = []

            def CFRelease(self, value):
                self.released.append(value)

        fake_iokit = FakeIOKit()
        fake_cf = FakeCoreFoundation()
        device_ref = object()
        with mock.patch.object(
            bridge, "_candidate_device_refs", return_value=[(device_ref, bridge.TRANSPORT_USB)]
        ), mock.patch.object(
            bridge, "_direct_hid_user_clients", side_effect=[{7: None}, {7: None, 9: None}]
        ), mock.patch.object(
            bridge, "_iokit", fake_iokit
        ), mock.patch.object(
            bridge, "_core_foundation", fake_cf
        ):
            device = bridge.open_device()
            self.assertIsNotNone(device)
            self.assertEqual(device._own_client_id, 9)
            device.close()

        self.assertEqual(fake_iokit.closed, [(device_ref, 0)])
        self.assertEqual(fake_cf.released, [device_ref])

    def test_sole_client_guard_ignores_idle_clients_and_blocks_active_readers(self):
        device = bridge.Device(object(), bridge.TRANSPORT_USB, own_client_id=101)
        with mock.patch.object(
            bridge,
            "_direct_hid_user_clients",
            return_value={101: (True, True), 202: (True, False)},
        ):
            device.require_sole_client(require_own_queue=True)

        with mock.patch.object(
            bridge,
            "_direct_hid_user_clients",
            return_value={101: (True, True), 202: (True, True)},
        ):
            with self.assertRaisesRegex(bridge.BridgeError, "another_hid_client"):
                device.require_sole_client(require_own_queue=True)

    def test_sole_client_guard_fails_closed_on_missing_or_malformed_own_state(self):
        device = bridge.Device(object(), bridge.TRANSPORT_USB, own_client_id=101)
        for clients in (
            {},
            {101: (False, False)},
            {101: (True, False)},
            {101: (True, True), 202: None},
        ):
            with self.subTest(clients=clients):
                with mock.patch.object(
                    bridge,
                    "_direct_hid_user_clients",
                    return_value=clients,
                ):
                    with self.assertRaisesRegex(
                        bridge.BridgeError, "ownership_check_failed"
                    ):
                        device.require_sole_client(require_own_queue=True)

    def test_probe_reports_busy_before_requesting_device_status(self):
        emitted = []

        class FakeEmitter:
            def emit(self, record):
                emitted.append(record)
                return True

        class BusyDevice:
            transport = bridge.TRANSPORT_USB
            status_requested = False

            def __enter__(self):
                return self

            def __exit__(self, *_exc):
                return None

            def require_sole_client(self):
                raise bridge.BridgeError("another_hid_client")

            def status_round_trip(self):
                self.status_requested = True
                return {"firmwareVersion": "0.4.1"}

        device = BusyDevice()
        with mock.patch.object(
            bridge, "is_supported", return_value=True
        ), mock.patch.object(
            bridge, "open_device", return_value=device
        ), mock.patch.object(
            bridge, "NdjsonEmitter", return_value=FakeEmitter()
        ):
            self.assertEqual(bridge.run_probe(), 5)

        self.assertFalse(device.status_requested)
        self.assertEqual(
            emitted,
            [{
                "version": 1,
                "type": "probe",
                "status": "busy",
                "reason": "another_hid_client",
                "transport": "usb",
            }],
        )

    def test_probe_never_claims_guarded_without_scheduled_own_queue(self):
        emitted = []

        class FakeEmitter:
            def emit(self, record):
                emitted.append(record)
                return True

        device = bridge.Device(object(), bridge.TRANSPORT_USB, own_client_id=1)
        guard_checks = []
        status_writes = []

        def require_sole_client(require_own_queue=False):
            guard_checks.append(require_own_queue)
            if require_own_queue:
                raise bridge.BridgeError("ownership_check_failed")

        def fake_stream(on_message, seconds=0.0, on_tick=None, tick_interval=0.0):
            self.assertIsNotNone(on_tick)
            on_tick()
            # A queued reply cannot recover an epoch whose scheduled queue
            # attestation already failed.
            on_message({"id": 17, "result": {"version": "0.4.1"}})

        with mock.patch.object(
            bridge, "is_supported", return_value=True
        ), mock.patch.object(
            bridge, "open_device", return_value=device
        ), mock.patch.object(
            bridge, "NdjsonEmitter", return_value=FakeEmitter()
        ), mock.patch.object(
            device, "require_sole_client", side_effect=require_sole_client
        ), mock.patch.object(
            device, "_send_status_request", side_effect=status_writes.append
        ), mock.patch.object(
            device, "stream", side_effect=fake_stream
        ), mock.patch.object(
            device, "close", return_value=None
        ), mock.patch.object(
            bridge.secrets, "randbelow", return_value=17
        ):
            self.assertEqual(bridge.run_probe(), 5)

        self.assertEqual(guard_checks, [False, True])
        self.assertEqual(status_writes, [])
        self.assertEqual(emitted[0]["status"], "unavailable")
        self.assertEqual(emitted[0]["reason"], "ownership_check_failed")
        self.assertNotIn("ownership", emitted[0])

    def test_watch_attests_and_reads_input_in_one_continuous_stream(self):
        emitted = []
        timeline = []

        class FakeEmitter:
            def __init__(self, stop_event=None):
                self.stop_event = stop_event

            def emit(self, record):
                emitted.append(record)
                timeline.append(("emit", record.get("state") or record.get("type")))
                if record.get("type") == "input":
                    self.stop_event.set()
                return True

        class ContinuousDevice:
            transport = bridge.TRANSPORT_USB
            removed = False

            def __init__(self):
                self.stream_calls = 0
                self.sent_ids = []
                self.guard_checks = []
                self.in_stream = False
                self.closed = False

            def require_sole_client(self, require_own_queue=False):
                self.guard_checks.append(require_own_queue)
                timeline.append(("guard", require_own_queue))

            def status_round_trip(self, shutdown=None):
                raise AssertionError("watch must not create a separate status stream")

            def _send_status_request(self, request_id):
                self.assert_in_stream()
                self.sent_ids.append(request_id)
                timeline.append(("send-status", request_id))

            def assert_in_stream(self):
                if not self.in_stream:
                    raise AssertionError("status sent before listener registration")

            def stream(self, on_message, on_tick=None):
                self.stream_calls += 1
                self.in_stream = True
                timeline.append(("stream", "start"))
                early_input = {
                    "m": bridge.EVENT_KEY,
                    "p": {"k": "AG00", "act": 1},
                }
                # The same press must remain valid after attestation. This
                # catches accidental pre-attestation InputValidator mutation.
                on_message(early_input)
                on_tick()
                on_message(
                    {
                        "id": self.sent_ids[-1],
                        "result": {"version": "0.4.1"},
                    }
                )
                on_message(early_input)
                self.in_stream = False

            def request_stop(self):
                return None

            def close(self):
                self.closed = True

        device = ContinuousDevice()
        with mock.patch.object(
            bridge, "is_supported", return_value=True
        ), mock.patch.object(
            bridge, "open_device", return_value=device
        ), mock.patch.object(
            bridge, "NdjsonEmitter", FakeEmitter
        ), mock.patch.object(
            bridge, "_watch_stdin_eof", return_value=None
        ), mock.patch.object(
            bridge, "_install_signal_handlers", return_value=None
        ), mock.patch.object(
            bridge.secrets, "randbelow", return_value=0
        ) as random_id:
            self.assertEqual(bridge.run_watch(), 0)

        random_id.assert_called_once_with(999)
        self.assertEqual(device.stream_calls, 1)
        self.assertEqual(device.sent_ids, [0])
        self.assertEqual(device.guard_checks, [False, True, True, True])
        self.assertTrue(device.closed)
        self.assertEqual(
            [(record.get("state"), record.get("type")) for record in emitted],
            [("connected", "status"), (None, "input")],
        )
        self.assertEqual(emitted[1]["input"], "AG00")
        self.assertLess(
            timeline.index(("stream", "start")),
            timeline.index(("send-status", 0)),
        )
        self.assertLess(
            timeline.index(("send-status", 0)),
            timeline.index(("emit", "connected")),
        )

    def test_watch_status_timeout_never_attests_or_emits_input(self):
        emitted = []

        class FakeEmitter:
            def __init__(self, stop_event=None):
                self.stop_event = stop_event

            def emit(self, record):
                emitted.append(record)
                if record.get("detail") == "status_timeout":
                    self.stop_event.set()
                return True

        class TimeoutDevice:
            transport = bridge.TRANSPORT_USB
            removed = False

            def __init__(self):
                self.stream_calls = 0
                self.sent_ids = []
                self.stop_requested = False
                self.closed = False

            def require_sole_client(self, require_own_queue=False):
                return None

            def _send_status_request(self, request_id):
                self.sent_ids.append(request_id)

            def stream(self, on_message, on_tick=None):
                self.stream_calls += 1
                on_tick()
                on_message(
                    {
                        "id": (self.sent_ids[-1] + 1) % 999,
                        "result": {"version": "wrong-request"},
                    }
                )
                on_message({"m": bridge.EVENT_KEY, "p": {"k": "AG00", "act": 1}})
                on_tick()
                # A terminal timeout must latch even if the device queues a
                # later valid reply and input before the run loop unwinds.
                on_message(
                    {
                        "id": self.sent_ids[-1],
                        "result": {"version": "late-valid-reply"},
                    }
                )
                on_message({"m": bridge.EVENT_KEY, "p": {"k": "AG00", "act": 1}})

            def request_stop(self):
                self.stop_requested = True

            def close(self):
                self.closed = True

        device = TimeoutDevice()
        with mock.patch.object(
            bridge, "is_supported", return_value=True
        ), mock.patch.object(
            bridge, "open_device", return_value=device
        ), mock.patch.object(
            bridge, "NdjsonEmitter", FakeEmitter
        ), mock.patch.object(
            bridge, "_watch_stdin_eof", return_value=None
        ), mock.patch.object(
            bridge, "_install_signal_handlers", return_value=None
        ), mock.patch.object(
            bridge.secrets, "randbelow", return_value=31
        ), mock.patch.object(
            bridge.time, "monotonic", side_effect=[10.0, 10.1, 12.2]
        ):
            self.assertEqual(bridge.run_watch(), 0)

        self.assertEqual(device.stream_calls, 1)
        self.assertEqual(device.sent_ids, [31])
        self.assertTrue(device.stop_requested)
        self.assertTrue(device.closed)
        self.assertEqual(
            emitted,
            [
                {
                    "version": 1,
                    "type": "status",
                    "state": "unavailable",
                    "detail": "status_timeout",
                    "transport": "usb",
                }
            ],
        )

    def test_watch_status_reply_conflict_never_emits_connected(self):
        emitted = []

        class FakeEmitter:
            def __init__(self, stop_event=None):
                self.stop_event = stop_event

            def emit(self, record):
                emitted.append(record)
                if record.get("state") == "busy":
                    self.stop_event.set()
                return True

        class AttestationRaceDevice:
            transport = bridge.TRANSPORT_USB
            removed = False

            def __init__(self):
                self.queue_checks = 0
                self.sent_id = None
                self.stream_calls = 0

            def require_sole_client(self, require_own_queue=False):
                if require_own_queue:
                    self.queue_checks += 1
                    if self.queue_checks == 2:
                        raise bridge.BridgeError("another_hid_client")

            def _send_status_request(self, request_id):
                self.sent_id = request_id

            def stream(self, on_message, on_tick=None):
                self.stream_calls += 1
                on_message({"m": bridge.EVENT_KEY, "p": {"k": "AG00", "act": 1}})
                on_tick()
                on_message(
                    {
                        "id": self.sent_id,
                        "result": {"version": "0.4.1"},
                    }
                )
                # The ownership failure is terminal for this epoch, even if
                # later callbacks would observe the competitor as gone.
                on_message(
                    {
                        "id": self.sent_id,
                        "result": {"version": "late-valid-reply"},
                    }
                )
                on_message({"m": bridge.EVENT_KEY, "p": {"k": "AG00", "act": 1}})

            def request_stop(self):
                return None

            def close(self):
                return None

        device = AttestationRaceDevice()
        with mock.patch.object(
            bridge, "is_supported", return_value=True
        ), mock.patch.object(
            bridge, "open_device", return_value=device
        ), mock.patch.object(
            bridge, "NdjsonEmitter", FakeEmitter
        ), mock.patch.object(
            bridge, "_watch_stdin_eof", return_value=None
        ), mock.patch.object(
            bridge, "_install_signal_handlers", return_value=None
        ), mock.patch.object(
            bridge.secrets, "randbelow", return_value=23
        ):
            self.assertEqual(bridge.run_watch(), 0)

        self.assertEqual(device.stream_calls, 1)
        self.assertEqual(device.queue_checks, 2)
        self.assertEqual([record.get("state") for record in emitted], ["busy"])
        self.assertFalse(any(record.get("type") == "input" for record in emitted))

    def test_watch_removal_before_attestation_reports_device_removed(self):
        emitted = []

        class FakeEmitter:
            def __init__(self, stop_event=None):
                self.stop_event = stop_event

            def emit(self, record):
                emitted.append(record)
                if record.get("detail") == "device_removed":
                    self.stop_event.set()
                return True

        class RemovedDevice:
            transport = bridge.TRANSPORT_USB

            def __init__(self):
                self.removed = False
                self.sent_ids = []
                self.stream_calls = 0
                self.closed = False
                self.stop_requested = False

            def require_sole_client(self, require_own_queue=False):
                return None

            def _send_status_request(self, request_id):
                self.sent_ids.append(request_id)

            def stream(self, _on_message, on_tick=None):
                self.stream_calls += 1
                # Mirror a removal arriving during the run-loop turn. No tick
                # may touch the detached device afterward.
                self.removed = True
                on_tick()

            def request_stop(self):
                self.stop_requested = True

            def close(self):
                self.closed = True

        device = RemovedDevice()
        with mock.patch.object(
            bridge, "is_supported", return_value=True
        ), mock.patch.object(
            bridge, "open_device", return_value=device
        ), mock.patch.object(
            bridge, "NdjsonEmitter", FakeEmitter
        ), mock.patch.object(
            bridge, "_watch_stdin_eof", return_value=None
        ), mock.patch.object(
            bridge, "_install_signal_handlers", return_value=None
        ), mock.patch.object(
            bridge.secrets, "randbelow", return_value=29
        ):
            self.assertEqual(bridge.run_watch(), 0)

        self.assertEqual(device.stream_calls, 1)
        self.assertEqual(device.sent_ids, [])
        self.assertTrue(device.stop_requested)
        self.assertTrue(device.closed)
        self.assertEqual(
            emitted,
            [
                {
                    "version": 1,
                    "type": "status",
                    "state": "disconnected",
                    "detail": "device_removed",
                    "transport": "usb",
                }
            ],
        )

    def test_watch_discards_the_triggering_input_before_reporting_busy(self):
        emitted = []

        class FakeEmitter:
            def __init__(self, stop_event=None):
                self.stop_event = stop_event

            def emit(self, record):
                emitted.append(record)
                if record.get("state") == "busy":
                    self.stop_event.set()
                return True

        class RacingDevice:
            transport = bridge.TRANSPORT_USB
            removed = False

            def __init__(self):
                self.queue_checks = 0
                self.sent_id = None
                self.stream_calls = 0

            def require_sole_client(self, require_own_queue=False):
                if require_own_queue:
                    self.queue_checks += 1
                    if self.queue_checks == 3:
                        raise bridge.BridgeError("another_hid_client")

            def _send_status_request(self, request_id):
                self.sent_id = request_id

            def stream(self, on_message, on_tick=None):
                self.stream_calls += 1
                on_tick()
                on_message(
                    {
                        "id": self.sent_id,
                        "result": {"version": "0.4.1"},
                    }
                )
                on_message({"m": bridge.EVENT_KEY, "p": {"k": "AG00", "act": 1}})

            def request_stop(self):
                return None

            def close(self):
                return None

        device = RacingDevice()
        with mock.patch.object(
            bridge, "is_supported", return_value=True
        ), mock.patch.object(
            bridge, "open_device", return_value=device
        ), mock.patch.object(
            bridge, "NdjsonEmitter", FakeEmitter
        ), mock.patch.object(
            bridge, "_watch_stdin_eof", return_value=None
        ), mock.patch.object(
            bridge, "_install_signal_handlers", return_value=None
        ), mock.patch.object(
            bridge.secrets, "randbelow", return_value=19
        ):
            self.assertEqual(bridge.run_watch(), 0)

        self.assertEqual(device.stream_calls, 1)
        self.assertEqual(device.queue_checks, 3)
        self.assertEqual([record.get("state") for record in emitted], ["connected", "busy"])
        self.assertFalse(any(record.get("type") == "input" for record in emitted))

    def test_ioobject_conforms_to_uses_darwin_32_bit_boolean_abi(self):
        if bridge._iokit is None:
            self.skipTest("IOKit is only loaded on macOS")
        self.assertIs(bridge._iokit.IOObjectConformsTo.restype, bridge.ctypes.c_uint32)


if __name__ == "__main__":
    unittest.main()

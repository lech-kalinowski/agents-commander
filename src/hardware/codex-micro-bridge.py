#!/usr/bin/env python3
"""Minimal macOS bridge for Codex Micro input events.

This helper is deliberately capability-limited:

* ``--probe`` performs one read-only ``device.status`` round trip, emits one
  bounded NDJSON record, and exits.
* ``--watch`` emits connection transitions and validated input events.  It
  reconnects after unplug/sleep and stops on SIGTERM or stdin EOF.
* The only host-to-device method present in this program is ``device.status``.
  There is no generic RPC command path and no lighting, filesystem, firmware,
  bootloader, or self-test operation.
* Device serial numbers and registry locations are neither read nor emitted.

Wire framing and the macOS IOKit access pattern are adapted from FreeMicro:
https://github.com/eliBenven/freemicro/blob/64258eb6cc3312a43f9f9f86d87e55e0b609ccc5/src/freemicro/device/codex_micro.py

FreeMicro is licensed under the MIT License:

Copyright (c) 2026 Eli Benveniste

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
"""

from __future__ import annotations

import argparse
import ctypes
import ctypes.util
import json
import math
import os
import secrets
import signal
import sys
import threading
import time
from typing import Any, Callable, Dict, List, Optional, Sequence, Set, Tuple


BRIDGE_PROTOCOL_VERSION = 1

VENDOR_ID = 0x303A
PRODUCT_ID = 0x8360
REPORT_ID = 6

REPORT_BYTES_USB = 63
REPORT_BYTES_BLE = 64
OPCODE_DATA = 0x02
MAX_CHUNK_BYTES = REPORT_BYTES_USB - 2

TRANSPORT_USB = "USB"
TRANSPORT_BLE = "Bluetooth Low Energy"

EVENT_KEY = "v.oai.hid"
EVENT_JOYSTICK = "v.oai.rad"

REAL_KEYS = frozenset(
    ["AG%02d" % index for index in range(6)]
    + ["ACT%02d" % index for index in range(6, 13)]
    + ["ENC_CLK"]
)
ENCODER_TICKS = frozenset(["ENC_CW", "ENC_CC"])

MAX_DEVICE_MESSAGE_BYTES = 4096
MAX_NDJSON_BYTES = 1024
MAX_FIRMWARE_VERSION_CHARS = 64
STATUS_TIMEOUT_SECONDS = 2.0
RUN_LOOP_TICK_SECONDS = 0.10
PRESENCE_CHECK_SECONDS = 0.50
RETRY_MIN_SECONDS = 0.25
RETRY_MAX_SECONDS = 5.0

_REPORT_TYPE_OUTPUT = 1  # kIOHIDReportTypeOutput
_CF_STRING_UTF8 = 0x08000100
_CF_NUMBER_SINT32 = 3
_IORETURN_NOT_PRIVILEGED = 0xE00002C1
_IORETURN_EXCLUSIVE_ACCESS = 0xE00002C5
_IORETURN_NOT_PERMITTED = 0xE00002E2


class BridgeError(RuntimeError):
    """A bounded, non-sensitive bridge failure."""


def _transport_label(transport: str) -> str:
    if transport == TRANSPORT_USB:
        return "usb"
    if transport == TRANSPORT_BLE:
        return "bluetooth"
    return "unknown"


# ---------------------------------------------------------------------------
# Vendor report framing and decoding (pure; exercised without hardware)
# ---------------------------------------------------------------------------


def frame_message(payload: str, transport: str = TRANSPORT_USB) -> List[bytes]:
    """Frame a bounded JSON string for report ID 6.

    USB expects ``[0x02][length][data...]`` in a 63-byte output buffer.
    Bluetooth LE expects ``[0x06][0x02][length][data...]`` in a 64-byte
    output buffer.  Both are submitted to IOKit with ``reportID=6``.
    """

    if transport not in (TRANSPORT_USB, TRANSPORT_BLE):
        raise BridgeError("unsupported_transport")
    try:
        data = payload.encode("utf-8") + b"\r\n"
    except UnicodeError as exc:
        raise BridgeError("invalid_payload") from exc
    if len(data) > MAX_DEVICE_MESSAGE_BYTES:
        raise BridgeError("payload_too_large")

    is_ble = transport == TRANSPORT_BLE
    report_size = REPORT_BYTES_BLE if is_ble else REPORT_BYTES_USB
    prefix = 1 if is_ble else 0
    reports: List[bytes] = []
    for offset in range(0, len(data), MAX_CHUNK_BYTES):
        chunk = data[offset : offset + MAX_CHUNK_BYTES]
        report = bytearray(report_size)
        if is_ble:
            report[0] = REPORT_ID
        report[prefix] = OPCODE_DATA
        report[prefix + 1] = len(chunk)
        report[prefix + 2 : prefix + 2 + len(chunk)] = chunk
        reports.append(bytes(report))
    return reports


class FrameDecoder:
    """Reassemble bounded CRLF-terminated JSON objects from report ID 6."""

    def __init__(self) -> None:
        self._buffer = bytearray()

    def reset(self) -> None:
        self._buffer.clear()

    def feed(self, raw: bytes) -> List[Dict[str, Any]]:
        if not isinstance(raw, bytes) or len(raw) > REPORT_BYTES_BLE:
            self.reset()
            return []

        if len(raw) >= 3 and raw[0] == REPORT_ID and raw[1] == OPCODE_DATA:
            start = 1
        elif len(raw) >= 2 and raw[0] == OPCODE_DATA:
            start = 0
        else:
            self.reset()
            return []

        declared = raw[start + 1]
        available = len(raw) - (start + 2)
        if declared > MAX_CHUNK_BYTES or declared > available:
            self.reset()
            return []
        body = raw[start + 2 : start + 2 + declared]
        if len(self._buffer) + len(body) > MAX_DEVICE_MESSAGE_BYTES:
            self.reset()
            return []
        self._buffer.extend(body)

        messages: List[Dict[str, Any]] = []
        while True:
            marker = self._buffer.find(b"\r\n")
            if marker < 0:
                break
            line = bytes(self._buffer[:marker])
            del self._buffer[: marker + 2]
            if not line or len(line) > MAX_DEVICE_MESSAGE_BYTES:
                continue
            try:
                parsed = json.loads(line.decode("utf-8", "strict"))
            except (UnicodeError, ValueError):
                continue
            if isinstance(parsed, dict):
                messages.append(parsed)
        return messages


def _method_and_params(message: Dict[str, Any]) -> Optional[Tuple[str, Any]]:
    compact_method = message.get("m")
    standard_method = message.get("method")
    if compact_method is not None and standard_method is not None:
        if compact_method != standard_method:
            return None
    method = compact_method if compact_method is not None else standard_method
    if not isinstance(method, str):
        return None

    compact_present = "p" in message
    standard_present = "params" in message
    if compact_present and standard_present and message["p"] != message["params"]:
        return None
    params = message.get("p") if compact_present else message.get("params")
    return method, params


def _finite_unit_number(value: Any) -> Optional[float]:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = float(value)
    if not math.isfinite(number) or number < 0.0 or number > 1.0:
        return None
    return 0.0 if number == 0.0 else number


class InputValidator:
    """Convert vendor notifications to edge-only, bounded input records."""

    def __init__(self) -> None:
        self._pressed: Set[str] = set()

    def reset(self) -> None:
        self._pressed.clear()

    def decode(self, message: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        extracted = _method_and_params(message)
        if extracted is None:
            return None
        method, params = extracted
        if not isinstance(params, dict):
            return None

        if method == EVENT_KEY:
            control = params.get("k")
            if not isinstance(control, str):
                return None
            if control in ENCODER_TICKS:
                # Dial detents are momentary. Firmware has emitted several
                # different act values, so the control id is the validation.
                return {"kind": "encoder", "control": control, "act": 1}
            if control not in REAL_KEYS:
                return None

            act = params.get("act")
            if isinstance(act, bool) or not isinstance(act, int):
                return None
            if act == 0:
                if control not in self._pressed:
                    return None
                self._pressed.discard(control)
                return {"kind": "key", "control": control, "act": 0}
            if act != 1 or control in self._pressed:
                return None
            self._pressed.add(control)
            return {"kind": "key", "control": control, "act": 1}

        if method == EVENT_JOYSTICK:
            angle = _finite_unit_number(params.get("a"))
            distance = _finite_unit_number(params.get("d"))
            if angle is None or distance is None:
                return None
            return {"kind": "joystick", "angle": angle, "distance": distance}

        return None


def sanitize_device_status(result: Any) -> Optional[Dict[str, Any]]:
    """Allowlist harmless status fields; never forward the raw device reply."""

    if not isinstance(result, dict):
        return None
    sanitized: Dict[str, Any] = {}

    version = result.get("version")
    if isinstance(version, str):
        printable = "".join(char for char in version if char.isprintable())
        sanitized["firmwareVersion"] = printable[:MAX_FIRMWARE_VERSION_CHARS]

    for source, destination in (
        ("profile_index", "profileIndex"),
        ("layer_index", "layerIndex"),
    ):
        value = result.get(source)
        if isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= 255:
            sanitized[destination] = value

    battery = result.get("battery")
    if isinstance(battery, (int, float)) and not isinstance(battery, bool):
        value = float(battery)
        if math.isfinite(value) and 0.0 <= value <= 100.0:
            sanitized["batteryPercent"] = int(value) if value.is_integer() else value

    charging = result.get("is_charging")
    if isinstance(charging, bool):
        sanitized["charging"] = charging

    return sanitized


class NdjsonEmitter:
    """Serialize only small, single-line IPC records."""

    def __init__(self, stop_event: Optional[threading.Event] = None) -> None:
        self._stop_event = stop_event

    def emit(self, record: Dict[str, Any]) -> bool:
        try:
            encoded = json.dumps(
                record,
                ensure_ascii=True,
                allow_nan=False,
                separators=(",", ":"),
                sort_keys=True,
            ).encode("utf-8")
        except (TypeError, ValueError):
            encoded = b'{"reason":"serialization_failed","type":"bridge.error","version":1}'
        if len(encoded) > MAX_NDJSON_BYTES or b"\n" in encoded or b"\r" in encoded:
            encoded = b'{"reason":"output_too_large","type":"bridge.error","version":1}'
        try:
            sys.stdout.buffer.write(encoded + b"\n")
            sys.stdout.buffer.flush()
            return True
        except (BrokenPipeError, OSError):
            if self._stop_event is not None:
                self._stop_event.set()
            return False


# ---------------------------------------------------------------------------
# macOS IOKit binding
# ---------------------------------------------------------------------------


_iokit: Optional[ctypes.CDLL] = None
_core_foundation: Optional[ctypes.CDLL] = None
_unsupported_reason = "macos_required"

if sys.platform == "darwin":
    try:
        iokit_path = ctypes.util.find_library("IOKit")
        core_foundation_path = ctypes.util.find_library("CoreFoundation")
        if not iokit_path or not core_foundation_path:
            raise OSError("framework_not_found")
        _iokit = ctypes.CDLL(iokit_path)
        _core_foundation = ctypes.CDLL(core_foundation_path)
        _unsupported_reason = ""
    except (OSError, TypeError):
        _iokit = None
        _core_foundation = None
        _unsupported_reason = "framework_unavailable"


def _configure_ctypes() -> None:
    assert _iokit is not None and _core_foundation is not None

    _core_foundation.CFStringCreateWithCString.restype = ctypes.c_void_p
    _core_foundation.CFStringCreateWithCString.argtypes = [
        ctypes.c_void_p,
        ctypes.c_char_p,
        ctypes.c_uint32,
    ]
    _core_foundation.CFRelease.restype = None
    _core_foundation.CFRelease.argtypes = [ctypes.c_void_p]
    _core_foundation.CFNumberGetValue.restype = ctypes.c_bool
    _core_foundation.CFNumberGetValue.argtypes = [
        ctypes.c_void_p,
        ctypes.c_int,
        ctypes.c_void_p,
    ]
    _core_foundation.CFStringGetCString.restype = ctypes.c_bool
    _core_foundation.CFStringGetCString.argtypes = [
        ctypes.c_void_p,
        ctypes.c_char_p,
        ctypes.c_long,
        ctypes.c_uint32,
    ]
    _core_foundation.CFRunLoopGetCurrent.restype = ctypes.c_void_p
    _core_foundation.CFRunLoopRunInMode.restype = ctypes.c_int32
    _core_foundation.CFRunLoopRunInMode.argtypes = [
        ctypes.c_void_p,
        ctypes.c_double,
        ctypes.c_bool,
    ]

    _iokit.IOServiceMatching.restype = ctypes.c_void_p
    _iokit.IOServiceMatching.argtypes = [ctypes.c_char_p]
    _iokit.IOServiceGetMatchingServices.restype = ctypes.c_int
    _iokit.IOServiceGetMatchingServices.argtypes = [
        ctypes.c_uint,
        ctypes.c_void_p,
        ctypes.POINTER(ctypes.c_uint),
    ]
    _iokit.IOIteratorNext.restype = ctypes.c_uint
    _iokit.IOIteratorNext.argtypes = [ctypes.c_uint]
    _iokit.IOObjectRelease.restype = ctypes.c_int
    _iokit.IOObjectRelease.argtypes = [ctypes.c_uint]
    _iokit.IORegistryEntryCreateCFProperty.restype = ctypes.c_void_p
    _iokit.IORegistryEntryCreateCFProperty.argtypes = [
        ctypes.c_uint,
        ctypes.c_void_p,
        ctypes.c_void_p,
        ctypes.c_uint32,
    ]
    _iokit.IOHIDDeviceCreate.restype = ctypes.c_void_p
    _iokit.IOHIDDeviceCreate.argtypes = [ctypes.c_void_p, ctypes.c_uint]
    _iokit.IOHIDDeviceOpen.restype = ctypes.c_int
    _iokit.IOHIDDeviceOpen.argtypes = [ctypes.c_void_p, ctypes.c_uint32]
    _iokit.IOHIDDeviceClose.restype = ctypes.c_int
    _iokit.IOHIDDeviceClose.argtypes = [ctypes.c_void_p, ctypes.c_uint32]
    _iokit.IOHIDDeviceScheduleWithRunLoop.restype = None
    _iokit.IOHIDDeviceScheduleWithRunLoop.argtypes = [
        ctypes.c_void_p,
        ctypes.c_void_p,
        ctypes.c_void_p,
    ]
    _iokit.IOHIDDeviceUnscheduleFromRunLoop.restype = None
    _iokit.IOHIDDeviceUnscheduleFromRunLoop.argtypes = [
        ctypes.c_void_p,
        ctypes.c_void_p,
        ctypes.c_void_p,
    ]
    _iokit.IOHIDDeviceRegisterInputReportCallback.restype = None
    _iokit.IOHIDDeviceRegisterInputReportCallback.argtypes = [
        ctypes.c_void_p,
        ctypes.POINTER(ctypes.c_ubyte),
        ctypes.c_long,
        ctypes.c_void_p,
        ctypes.c_void_p,
    ]
    _iokit.IOHIDDeviceRegisterRemovalCallback.restype = None
    _iokit.IOHIDDeviceRegisterRemovalCallback.argtypes = [
        ctypes.c_void_p,
        ctypes.c_void_p,
        ctypes.c_void_p,
    ]
    _iokit.IOHIDDeviceSetReport.restype = ctypes.c_int
    _iokit.IOHIDDeviceSetReport.argtypes = [
        ctypes.c_void_p,
        ctypes.c_int,
        ctypes.c_long,
        ctypes.POINTER(ctypes.c_ubyte),
        ctypes.c_long,
    ]


if _iokit is not None and _core_foundation is not None:
    try:
        _configure_ctypes()
    except (AttributeError, OSError, TypeError):
        # A partial/older framework is unsupported, but importing the helper
        # must still succeed so --probe can return one well-formed status.
        _iokit = None
        _core_foundation = None
        _unsupported_reason = "framework_unavailable"


def is_supported() -> bool:
    return _iokit is not None and _core_foundation is not None


def _cf_string(text: str) -> Any:
    assert _core_foundation is not None
    return _core_foundation.CFStringCreateWithCString(
        None, text.encode("utf-8"), _CF_STRING_UTF8
    )


def _property_int(service: int, key: str) -> Optional[int]:
    assert _iokit is not None and _core_foundation is not None
    name = _cf_string(key)
    if not name:
        return None
    try:
        value_ref = _iokit.IORegistryEntryCreateCFProperty(service, name, None, 0)
    finally:
        _core_foundation.CFRelease(name)
    if not value_ref:
        return None
    result = ctypes.c_int32(0)
    try:
        if _core_foundation.CFNumberGetValue(
            value_ref, _CF_NUMBER_SINT32, ctypes.byref(result)
        ):
            return result.value
    finally:
        _core_foundation.CFRelease(value_ref)
    return None


def _property_string(service: int, key: str) -> Optional[str]:
    assert _iokit is not None and _core_foundation is not None
    name = _cf_string(key)
    if not name:
        return None
    try:
        value_ref = _iokit.IORegistryEntryCreateCFProperty(service, name, None, 0)
    finally:
        _core_foundation.CFRelease(name)
    if not value_ref:
        return None
    buffer = ctypes.create_string_buffer(128)
    try:
        if _core_foundation.CFStringGetCString(
            value_ref, buffer, len(buffer), _CF_STRING_UTF8
        ):
            return buffer.value.decode("utf-8", "replace")
    finally:
        _core_foundation.CFRelease(value_ref)
    return None


def _candidate_device_refs() -> List[Tuple[Any, str]]:
    """Return matching IOHIDDeviceRefs, preferring USB and reading no identity."""

    if not is_supported():
        return []
    assert _iokit is not None
    matching = _iokit.IOServiceMatching(b"IOHIDDevice")
    if not matching:
        raise BridgeError("discovery_failed")
    iterator = ctypes.c_uint(0)
    result = _iokit.IOServiceGetMatchingServices(0, matching, ctypes.byref(iterator))
    if result != 0:
        raise BridgeError("discovery_failed")

    refs: List[Tuple[Any, str]] = []
    try:
        while True:
            service = _iokit.IOIteratorNext(iterator.value)
            if not service:
                break
            try:
                if (
                    _property_int(service, "VendorID") != VENDOR_ID
                    or _property_int(service, "ProductID") != PRODUCT_ID
                ):
                    continue
                transport = _property_string(service, "Transport") or ""
                if transport not in (TRANSPORT_USB, TRANSPORT_BLE):
                    continue
                device_ref = _iokit.IOHIDDeviceCreate(None, service)
                if device_ref:
                    refs.append((device_ref, transport))
            finally:
                _iokit.IOObjectRelease(service)
    except Exception:
        if _core_foundation is not None:
            for device_ref, _transport in refs:
                try:
                    _core_foundation.CFRelease(device_ref)
                except Exception:
                    pass
        raise
    finally:
        if iterator.value:
            _iokit.IOObjectRelease(iterator.value)

    refs.sort(key=lambda candidate: 0 if candidate[1] == TRANSPORT_USB else 1)
    return refs


_INPUT_CALLBACK = ctypes.CFUNCTYPE(
    None,
    ctypes.c_void_p,
    ctypes.c_int,
    ctypes.c_void_p,
    ctypes.c_int,
    ctypes.c_uint32,
    ctypes.POINTER(ctypes.c_ubyte),
    ctypes.c_long,
)
_REMOVAL_CALLBACK = ctypes.CFUNCTYPE(
    None, ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p
)


class Device:
    """One open, input-only Codex Micro handle plus read-only status probe."""

    def __init__(self, ref: Any, transport: str) -> None:
        self._ref = ref
        self.transport = transport
        self._closed = False
        self._scheduled = False
        self._stop = False
        self._removed = False
        self._decoder = FrameDecoder()
        self._handler: Optional[Callable[[Dict[str, Any]], None]] = None
        self._input_callback: Any = None
        self._removal_callback: Any = None
        self._input_buffer: Any = None
        self._run_loop_mode: Any = None

    def request_stop(self) -> None:
        self._stop = True

    @property
    def removed(self) -> bool:
        return self._removed

    def _send_status_request(self, request_id: int) -> None:
        """The bridge's only host-to-device operation."""

        if self._closed:
            raise BridgeError("device_closed")
        message = json.dumps(
            {"m": "device.status", "id": request_id}, separators=(",", ":")
        )
        for report in frame_message(message, self.transport):
            buffer = (ctypes.c_ubyte * len(report)).from_buffer_copy(report)
            assert _iokit is not None
            result = _iokit.IOHIDDeviceSetReport(
                self._ref,
                _REPORT_TYPE_OUTPUT,
                REPORT_ID,
                buffer,
                len(report),
            )
            if result != 0:
                raise BridgeError("status_write_failed")

    def status_round_trip(
        self,
        timeout: float = STATUS_TIMEOUT_SECONDS,
        shutdown: Optional[threading.Event] = None,
    ) -> Optional[Dict[str, Any]]:
        """Return a sanitized ``device.status`` reply, never the raw payload."""

        request_id = secrets.randbelow(0x7FFFFFFE) + 1
        reply: List[Dict[str, Any]] = []
        sent = False
        self._decoder.reset()

        def on_message(message: Dict[str, Any]) -> None:
            if message.get("id") != request_id:
                return
            result = sanitize_device_status(message.get("result"))
            if result is not None:
                reply.append(result)
            self.request_stop()

        def on_tick() -> None:
            nonlocal sent
            if shutdown is not None and shutdown.is_set():
                self.request_stop()
                return
            if not sent:
                sent = True
                self._send_status_request(request_id)

        self.stream(
            on_message,
            seconds=timeout,
            on_tick=on_tick,
            tick_interval=0.05,
        )
        return reply[0] if reply else None

    def _ensure_callbacks(self) -> None:
        if self._input_callback is None:

            def input_callback(
                _context: Any,
                result: int,
                _sender: Any,
                _report_type: int,
                report_id: int,
                report: Any,
                length: int,
            ) -> None:
                try:
                    if result != 0:
                        self._removed = True
                        self._stop = True
                        return
                    if int(report_id) != REPORT_ID or self._handler is None:
                        return
                    count = max(0, min(int(length), REPORT_BYTES_BLE))
                    raw = bytes(bytearray(report[index] for index in range(count)))
                    messages = self._decoder.feed(raw)
                    for message in messages:
                        try:
                            self._handler(message)
                        except Exception:
                            continue
                except Exception:
                    return

            self._input_callback = _INPUT_CALLBACK(input_callback)
            self._input_buffer = (ctypes.c_ubyte * REPORT_BYTES_BLE)()

        if self._removal_callback is None:

            def removal_callback(
                _context: Any, _result: int, _sender: Any
            ) -> None:
                self._removed = True
                self._stop = True

            self._removal_callback = _REMOVAL_CALLBACK(removal_callback)

    def stream(
        self,
        on_message: Callable[[Dict[str, Any]], None],
        seconds: float = 0.0,
        on_tick: Optional[Callable[[], None]] = None,
        tick_interval: float = RUN_LOOP_TICK_SECONDS,
    ) -> None:
        assert _iokit is not None and _core_foundation is not None
        if self._closed:
            raise BridgeError("device_closed")

        self._ensure_callbacks()
        if self._run_loop_mode is None:
            self._run_loop_mode = _cf_string("kCFRunLoopDefaultMode")
            if not self._run_loop_mode:
                raise BridgeError("run_loop_failed")
        self._handler = on_message
        self._stop = False
        self._scheduled = True

        _iokit.IOHIDDeviceRegisterInputReportCallback(
            self._ref,
            self._input_buffer,
            REPORT_BYTES_BLE,
            self._input_callback,
            None,
        )
        _iokit.IOHIDDeviceRegisterRemovalCallback(
            self._ref, self._removal_callback, None
        )
        _iokit.IOHIDDeviceScheduleWithRunLoop(
            self._ref,
            _core_foundation.CFRunLoopGetCurrent(),
            self._run_loop_mode,
        )

        started = time.monotonic()
        try:
            while not self._stop:
                if seconds > 0.0 and time.monotonic() - started >= seconds:
                    break
                _core_foundation.CFRunLoopRunInMode(
                    self._run_loop_mode, tick_interval, False
                )
                if on_tick is not None:
                    on_tick()
        finally:
            self._unschedule()

    def _unschedule(self) -> None:
        if (
            self._closed
            or not self._scheduled
            or _iokit is None
            or _core_foundation is None
        ):
            return
        try:
            _iokit.IOHIDDeviceRegisterInputReportCallback(
                self._ref, self._input_buffer, REPORT_BYTES_BLE, None, None
            )
            _iokit.IOHIDDeviceRegisterRemovalCallback(self._ref, None, None)
            _iokit.IOHIDDeviceUnscheduleFromRunLoop(
                self._ref,
                _core_foundation.CFRunLoopGetCurrent(),
                self._run_loop_mode,
            )
        except Exception:
            pass
        self._scheduled = False
        self._handler = None

    def close(self) -> None:
        if self._closed:
            return
        self._unschedule()
        self._closed = True
        if _iokit is not None and self._ref:
            try:
                _iokit.IOHIDDeviceClose(self._ref, 0)
            except Exception:
                pass
        if _core_foundation is not None and self._run_loop_mode:
            try:
                _core_foundation.CFRelease(self._run_loop_mode)
            except Exception:
                pass
            self._run_loop_mode = None
        if _core_foundation is not None and self._ref:
            try:
                _core_foundation.CFRelease(self._ref)
            except Exception:
                pass
        self._ref = None

    def __enter__(self) -> "Device":
        return self

    def __exit__(self, *_exc: Any) -> None:
        self.close()


def open_device() -> Optional[Device]:
    """Open one exact VID/PID match, preferring USB; never read identity data."""

    refs = _candidate_device_refs()
    if not refs:
        return None
    assert _iokit is not None and _core_foundation is not None

    failure_codes: Set[int] = set()
    for index, (device_ref, transport) in enumerate(refs):
        result = _iokit.IOHIDDeviceOpen(device_ref, 0)
        if result == 0:
            for other_ref, _other_transport in refs[index + 1 :]:
                _core_foundation.CFRelease(other_ref)
            return Device(device_ref, transport)
        failure_codes.add(result & 0xFFFFFFFF)
        _core_foundation.CFRelease(device_ref)
    if failure_codes.intersection(
        {_IORETURN_NOT_PRIVILEGED, _IORETURN_NOT_PERMITTED}
    ):
        raise BridgeError("permission_denied")
    if _IORETURN_EXCLUSIVE_ACCESS in failure_codes:
        raise BridgeError("device_busy")
    raise BridgeError("open_failed")


def preferred_transport() -> Optional[str]:
    """Return the preferred matching transport without opening the device."""

    refs = _candidate_device_refs()
    if not refs:
        return None
    assert _core_foundation is not None
    transport = refs[0][1]
    for device_ref, _candidate_transport in refs:
        _core_foundation.CFRelease(device_ref)
    return transport


# ---------------------------------------------------------------------------
# Process lifecycle and NDJSON modes
# ---------------------------------------------------------------------------


def _base_record(record_type: str) -> Dict[str, Any]:
    return {"version": BRIDGE_PROTOCOL_VERSION, "type": record_type}


def _probe_record(
    status: str,
    reason: Optional[str] = None,
    transport: Optional[str] = None,
    device_status: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    record = _base_record("probe")
    record["status"] = status
    if reason is not None:
        record["reason"] = reason
    if transport is not None:
        record["transport"] = _transport_label(transport)
    if device_status is not None:
        record["device"] = device_status
    return record


def _status_record(
    state: str,
    detail: Optional[str] = None,
    transport: Optional[str] = None,
    device_status: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Build the exact status contract consumed by codex-micro-native.ts."""

    record = _base_record("status")
    record["state"] = state
    if detail is not None:
        record["detail"] = detail
    if transport is not None:
        record["transport"] = _transport_label(transport)
    if device_status is not None:
        firmware = device_status.get("firmwareVersion")
        battery = device_status.get("batteryPercent")
        charging = device_status.get("charging")
        if isinstance(firmware, str):
            record["firmware"] = firmware
        if isinstance(battery, (int, float)) and not isinstance(battery, bool):
            record["battery"] = battery
        if isinstance(charging, bool):
            record["charging"] = charging
    return record


def _watch_failure_state(reason: str) -> Tuple[str, str]:
    if reason == "permission_denied":
        return "permission-denied", "Input Monitoring permission is required"
    return "unavailable", reason


def watch_input_record(validated: Dict[str, Any]) -> Dict[str, Any]:
    """Build the exact input contract consumed by codex-micro-native.ts."""

    if validated.get("kind") == "joystick":
        record = _base_record("joystick")
        record["angle"] = validated["angle"]
        record["distance"] = validated["distance"]
        return record
    record = _base_record("input")
    record["input"] = validated["control"]
    record["act"] = validated["act"]
    return record


def run_probe() -> int:
    emitter = NdjsonEmitter()
    if not is_supported():
        emitter.emit(_probe_record("unsupported", _unsupported_reason))
        return 2

    try:
        device = open_device()
    except BridgeError as exc:
        emitter.emit(_probe_record("unavailable", str(exc)))
        return 4
    except Exception:
        emitter.emit(_probe_record("unavailable", "native_error"))
        return 4

    if device is None:
        emitter.emit(_probe_record("absent"))
        return 3

    transport = device.transport
    try:
        with device:
            status = device.status_round_trip()
    except BridgeError as exc:
        emitter.emit(_probe_record("unavailable", str(exc), transport))
        return 5
    except Exception:
        emitter.emit(_probe_record("unavailable", "native_error", transport))
        return 5
    if status is None:
        emitter.emit(_probe_record("unavailable", "status_timeout", transport))
        return 5
    emitter.emit(_probe_record("connected", transport=transport, device_status=status))
    return 0


def _watch_stdin_eof(stop_event: threading.Event) -> None:
    """Consume no commands; stdin is only a parent-liveness pipe."""

    try:
        descriptor = sys.stdin.fileno()
    except (AttributeError, OSError, ValueError):
        stop_event.set()
        return
    try:
        while not stop_event.is_set():
            chunk = os.read(descriptor, 4096)
            if not chunk:
                stop_event.set()
                return
    except OSError:
        stop_event.set()


def _install_signal_handlers(stop_event: threading.Event) -> None:
    def stop_handler(_signum: int, _frame: Any) -> None:
        stop_event.set()

    signal.signal(signal.SIGTERM, stop_handler)
    signal.signal(signal.SIGINT, stop_handler)


def run_watch() -> int:
    stop_event = threading.Event()
    _install_signal_handlers(stop_event)
    emitter = NdjsonEmitter(stop_event)

    if not is_supported():
        emitter.emit(_status_record("unavailable", _unsupported_reason))
        return 2

    stdin_thread = threading.Thread(
        target=_watch_stdin_eof,
        args=(stop_event,),
        name="codex-micro-stdin-watch",
        daemon=True,
    )
    stdin_thread.start()

    last_unconnected: Optional[Tuple[str, Optional[str], Optional[str]]] = None
    retry_delay = RETRY_MIN_SECONDS

    while not stop_event.is_set():
        try:
            device = open_device()
        except BridgeError as exc:
            state, detail = _watch_failure_state(str(exc))
            signature = (state, detail, None)
            if signature != last_unconnected:
                emitter.emit(_status_record(signature[0], signature[1]))
                last_unconnected = signature
            stop_event.wait(retry_delay)
            retry_delay = min(RETRY_MAX_SECONDS, retry_delay * 2.0)
            continue
        except Exception:
            signature = ("unavailable", "native_error", None)
            if signature != last_unconnected:
                emitter.emit(_status_record(signature[0], signature[1]))
                last_unconnected = signature
            stop_event.wait(retry_delay)
            retry_delay = min(RETRY_MAX_SECONDS, retry_delay * 2.0)
            continue

        if device is None:
            signature = ("disconnected", "device_not_found", None)
            if signature != last_unconnected:
                emitter.emit(_status_record(signature[0], signature[1]))
                last_unconnected = signature
            stop_event.wait(retry_delay)
            retry_delay = min(RETRY_MAX_SECONDS, retry_delay * 2.0)
            continue

        transport = device.transport
        try:
            status = device.status_round_trip(shutdown=stop_event)
        except BridgeError as exc:
            device.close()
            state, detail = _watch_failure_state(str(exc))
            signature = (state, detail, transport)
            if signature != last_unconnected:
                emitter.emit(_status_record(signature[0], signature[1], transport))
                last_unconnected = signature
            stop_event.wait(retry_delay)
            retry_delay = min(RETRY_MAX_SECONDS, retry_delay * 2.0)
            continue
        except Exception:
            device.close()
            signature = ("unavailable", "native_error", transport)
            if signature != last_unconnected:
                emitter.emit(_status_record(signature[0], signature[1], transport))
                last_unconnected = signature
            stop_event.wait(retry_delay)
            retry_delay = min(RETRY_MAX_SECONDS, retry_delay * 2.0)
            continue

        if stop_event.is_set():
            device.close()
            break
        if status is None:
            device.close()
            signature = ("unavailable", "status_timeout", transport)
            if signature != last_unconnected:
                emitter.emit(_status_record(signature[0], signature[1], transport))
                last_unconnected = signature
            stop_event.wait(retry_delay)
            retry_delay = min(RETRY_MAX_SECONDS, retry_delay * 2.0)
            continue

        retry_delay = RETRY_MIN_SECONDS
        last_unconnected = None
        validator = InputValidator()
        emitter.emit(
            _status_record(
                "connected",
                transport=transport,
                device_status=status,
            )
        )
        last_presence_check = time.monotonic()

        def on_message(message: Dict[str, Any]) -> None:
            validated = validator.decode(message)
            if validated is None:
                return
            record = watch_input_record(validated)
            if not emitter.emit(record):
                device.request_stop()

        def on_tick() -> None:
            nonlocal last_presence_check
            if stop_event.is_set():
                device.request_stop()
                return
            now = time.monotonic()
            if now - last_presence_check < PRESENCE_CHECK_SECONDS:
                return
            last_presence_check = now
            try:
                selected = preferred_transport()
            except Exception:
                selected = None
            if selected is None or selected != device.transport:
                device.request_stop()

        try:
            device.stream(on_message, on_tick=on_tick)
        except Exception:
            pass
        finally:
            removed = device.removed
            device.close()
            validator.reset()

        if stop_event.is_set():
            break
        emitter.emit(
            _status_record(
                "disconnected",
                detail="device_removed" if removed else "stream_ended",
                transport=transport,
            )
        )
        # Suppress a redundant immediate "absent" record; the disconnected
        # event already tells the parent that this epoch is invalid.
        last_unconnected = ("disconnected", "device_not_found", None)
        stop_event.wait(retry_delay)

    return 0


def _parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Read-only Codex Micro input bridge for macOS"
    )
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--probe", action="store_true", help="probe once and exit")
    mode.add_argument("--watch", action="store_true", help="watch until parent exits")
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = _parse_args(argv)
    return run_probe() if args.probe else run_watch()


if __name__ == "__main__":
    raise SystemExit(main())

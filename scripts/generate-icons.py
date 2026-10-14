#!/usr/bin/env python3
"""Generate pad's flat PNG icons using only Python's standard library."""
from pathlib import Path
import struct
import zlib

OUTPUT = Path(__file__).resolve().parent.parent / 'public' / 'icons'
OUTPUT.mkdir(parents=True, exist_ok=True)
BACKGROUND = (15, 15, 16)
FOREGROUND = (242, 242, 242)


def chunk(kind, data):
    return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)


def letter(x, y):
    stem = .34 <= x <= .425 and .28 <= y <= .76
    outer = ((x - .495) / .16) ** 2 + ((y - .425) / .155) ** 2 <= 1
    inner = ((x - .495) / .077) ** 2 + ((y - .425) / .075) ** 2 < 1
    return stem or (outer and not inner)


def icon(size, name):
    rows = bytearray()
    for y in range(size):
        rows.append(0)
        for x in range(size):
            coverage = sum(letter((x + dx) / size, (y + dy) / size)
                           for dx in (.25, .75) for dy in (.25, .75)) / 4
            rows.extend(round(bg + (fg - bg) * coverage)
                        for bg, fg in zip(BACKGROUND, FOREGROUND))
    data = b'\x89PNG\r\n\x1a\n'
    data += chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0))
    data += chunk(b'IDAT', zlib.compress(rows, 9)) + chunk(b'IEND', b'')
    (OUTPUT / name).write_bytes(data)


for size, name in ((192, 'pad-192.png'), (512, 'pad-512.png'),
                   (512, 'pad-maskable-512.png'), (180, 'apple-touch-icon.png')):
    icon(size, name)

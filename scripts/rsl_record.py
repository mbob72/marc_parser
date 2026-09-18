"""Read a single length-prefixed Aleph record at an exact byte offset."""
import argparse
import pathlib


def read_record(source, offset):
    source.seek(offset)
    prefix = source.read(10)
    if len(prefix) != 10 or not prefix[:9].isdigit() or prefix[9:] != b'\t':
        raise ValueError(f'Invalid record prefix at {offset}')
    raw = bytearray(prefix)
    fields = []
    while True:
        position = offset + len(raw)
        first = source.read(1)
        if not first:
            break
        if first == b'\n':
            raw.extend(first)
            break
        if first == b'\r':
            ending = first + source.read(1)
            if ending != b'\r\n':
                raise ValueError(f'Invalid CRLF at {position}')
            raw.extend(ending)
            break
        length = first + source.read(3)
        if len(length) != 4 or not length.isdigit() or int(length) < 6:
            raise ValueError(f'Invalid field length at {position}')
        value = source.read(int(length))
        if len(value) != int(length):
            raise ValueError(f'Truncated field at {position}')
        fields.append((position, length, value))
        raw.extend(length + value)
    return bytes(raw), fields


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=pathlib.Path)
    parser.add_argument('offset', type=int)
    parser.add_argument('output', type=pathlib.Path)
    args = parser.parse_args()
    with args.input.open('rb') as source:
        raw, _ = read_record(source, args.offset)
    with args.output.open('xb') as output:
        output.write(raw)
    print(f'{len(raw)} original bytes written to {args.output}')

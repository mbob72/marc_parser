import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import test from "node:test";
import type {
  MarcRecordContext,
  MarcRecordProcessor,
} from "../src/marc-record-processor.ts";
import { MarcRecordSplitter } from "../src/marc-record-splitter.ts";

const recordUrl = new URL(
  "../docs/015316815/015316815.mrc",
  import.meta.url,
);

interface ProcessedRecord {
  record: Buffer;
  context: MarcRecordContext;
}

class CollectingProcessor implements MarcRecordProcessor {
  readonly records: ProcessedRecord[] = [];

  process(record: Buffer, context: MarcRecordContext): void {
    this.records.push({ record: Buffer.from(record), context });
  }
}

test("собирает полные записи из маленьких чанков и передаёт их зависимости", async () => {
  const record = await readFile(recordUrl);
  const input = Buffer.concat([record, record]);
  const chunks: Buffer[] = [];

  for (let offset = 0; offset < input.length; offset += 17) {
    chunks.push(input.subarray(offset, offset + 17));
  }

  const processor = new CollectingProcessor();
  const splitter = new MarcRecordSplitter(processor);
  const outputChunks: Buffer[] = [];

  for await (const chunk of Readable.from(chunks).pipe(splitter)) {
    outputChunks.push(Buffer.from(chunk));
  }

  assert.equal(processor.records.length, 2);
  assert.deepEqual(processor.records[0]?.record, record);
  assert.deepEqual(processor.records[0]?.context, {
    recordIndex: 0,
    byteOffset: 0,
  });
  assert.deepEqual(processor.records[1]?.context, {
    recordIndex: 1,
    byteOffset: record.length,
  });
  assert.deepEqual(Buffer.concat(outputChunks), input);
});

test("отклоняет незавершённую запись в конце потока", async () => {
  const record = await readFile(recordUrl);
  const splitter = new MarcRecordSplitter(new CollectingProcessor());

  await assert.rejects(
    async () => {
      for await (const _chunk of Readable.from([record.subarray(0, 100)]).pipe(
        splitter,
      )) {
        // Поток необходимо полностью прочитать, чтобы получить ошибку _flush.
      }
    },
    /Неожиданный конец файла/,
  );
});

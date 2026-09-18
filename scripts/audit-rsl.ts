import { createReadStream } from 'node:fs';
import { open, mkdir, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { basename, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { AlephSequentialRecordSplitter } from '../src/aleph-sequential-record-splitter.js';
import { AlephSequentialMarcParser } from '../src/aleph-sequential-parser.js';
import { MarcRecordValidator } from '../src/marc-validator.js';
import { MarcJsonSerializer } from '../src/marc-json-serializer.js';
import { MarcJsonTransform } from '../src/marc-json-transform.js';

const [input, output, mode = 'strict'] = process.argv.slice(2);
if (!['strict', 'diagnostic'].includes(mode)) throw new Error('Mode must be strict or diagnostic');
if (!input || !output) throw new Error('Usage: npx tsx scripts/audit-rsl.ts input.dat artifact-directory');
await mkdir(output, { recursive: true });
const name = basename(input);
const report = await open(join(output, `${name}.${mode}.errors.ndjson`), 'wx');
const rules: Record<string, number> = {};
const messages: Record<string, { count: number; first: unknown }> = {};
let serializedBytes = 0;
const hash = createHash('sha256');
const started = new Date();
const transform = new MarcJsonTransform(new AlephSequentialMarcParser(), new MarcRecordValidator('utf-8'), new MarcJsonSerializer('utf-8'), {
  async logValidationResult(result, context) {
    if (result.valid) return;
    await report.writeFile(JSON.stringify({ ...context, errors: result.errors }) + '\n');
    for (const error of result.errors) {
      rules[error.rule] = (rules[error.rule] ?? 0) + 1;
      const key = `${error.rule}: ${error.message}`;
      const entry = messages[key] ??= { count: 0, first: { ...context, ...error } };
      entry.count++;
    }
  },
  async logParsingError(error, context) {
    await report.writeFile(JSON.stringify({ ...context, parsingError: error.message }) + '\n');
  },
  logSummary() {}, logFatalError() {},
});
let fatalError: string | undefined;
const source = createReadStream(input);
source.on('data', chunk => hash.update(chunk));
const parser = new AlephSequentialMarcParser();
const validator = new MarcRecordValidator('utf-8');
const serializer = new MarcJsonSerializer('utf-8');
const stats = { recordsProcessed: 0, validRecords: 0, recordsWithValidationErrors: 0, recordsWithParsingErrors: 0, validationErrors: 0, inputBytes: 0 };
const diagnostic = new AlephSequentialRecordSplitter({
  async process(buffer, context) {
    stats.recordsProcessed++; stats.inputBytes += buffer.length;
    let record;
    try { record = parser.parse(buffer); } catch (error) {
      stats.recordsWithParsingErrors++;
      await report.writeFile(JSON.stringify({ ...context, recordId: buffer.subarray(0, 9).toString(), parsingError: String(error) }) + '\n');
      return;
    }
    const result = validator.validate(record);
    if (result.valid) stats.validRecords++;
    else {
      stats.recordsWithValidationErrors++; stats.validationErrors += result.errors.length;
      await report.writeFile(JSON.stringify({ ...context, recordId: buffer.subarray(0, 9).toString(), errors: result.errors }) + '\n');
      for (const error of result.errors) {
        rules[error.rule] = (rules[error.rule] ?? 0) + 1;
        const key = `${error.rule}: ${error.message}`;
        const entry = messages[key] ??= { count: 0, first: { ...context, ...error } };
        entry.count++;
      }
    }
    serializedBytes += Buffer.byteLength(JSON.stringify(serializer.serialize(record)) + '\n');
  },
});
const progress = setInterval(() => console.error(name, mode === 'diagnostic' ? stats : transform.statistics), 30000);
try {
  if (mode === 'diagnostic') {
    await pipeline(source, diagnostic, new Writable({ write(_chunk, _encoding, callback) { callback(); } }));
  } else await pipeline(source, new AlephSequentialRecordSplitter(), transform, new Writable({
    write(chunk, _encoding, callback) { serializedBytes += chunk.length; callback(); },
  }));
} catch (error) { fatalError = String(error); }
finally { clearInterval(progress); await report.close(); }
const summary = {
  file: name, mode, category: /^rsl1[01]/.test(name) ? 'authority' : 'bibliographic',
  source: 'https://mrsadman.ru/ac34d2e7ff814dac/',
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  node: process.version, startedAt: started.toISOString(), completedAt: new Date().toISOString(),
  complete: !fatalError, fatalError, fileBytes: (await stat(input)).size,
  sha256: fatalError ? undefined : hash.digest('hex'),
  ...(mode === 'diagnostic' ? stats : transform.statistics), serializedBytes, rules, messages,
};
await writeFile(join(output, `${name}.${mode}.summary.json`), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
if (fatalError) process.exitCode = 1;

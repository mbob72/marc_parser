import type { Client } from "pg";
import type { CopyBatch, CopyManifest } from "./copy-packages.js";

/** Вызывается после COPY в открытой транзакции; имена и хеши проверяет readCopyManifest. */
// DOC-PREVIEW:/docs/documents-code.md#merge
// DOC-PREVIEW:/docs/import-storage.md#code
export async function mergeCopy(
  client: Client,
  manifest: CopyManifest,
  batch: CopyBatch,
): Promise<void> {
  const archive = manifest.archiveSha256,
    source = batch.sourceFile,
    sha = batch.sourceSha256;
  const library = manifest.libraryCode ?? "RSL01";
  // Параметры относятся к одному пакету; SQL не интерполирует пользовательские строки.
  await client.query(
    "CREATE TEMP TABLE import_context(archive text,file text,sha text,library text) ON COMMIT DROP",
  );
  await client.query("INSERT INTO import_context VALUES($1,$2,$3,$4)", [
    archive,
    source,
    sha,
    library,
  ]);
  await client.query(
    "INSERT INTO import.bib_sources VALUES($1,$2) ON CONFLICT(sha256) DO UPDATE SET path=excluded.path",
    [archive, manifest.sourceInput],
  );
  await client.query(String.raw`ANALYZE document_incoming;
SELECT pg_advisory_xact_lock(hashtext('import.bib_ids.merge'));
LOCK TABLE import.bib_ids IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.documents IN SHARE ROW EXCLUSIVE MODE;
DO $$ BEGIN

 IF EXISTS(SELECT d.system_number FROM public.documents d JOIN document_incoming i USING(system_number) WHERE upper(d.library_code)=(SELECT library FROM import_context) GROUP BY d.system_number HAVING count(*)>1) THEN RAISE EXCEPTION 'Ambiguous documents'; END IF;
 IF EXISTS(SELECT 1 FROM document_incoming i JOIN import.bib_ids x ON x.library_code=(SELECT library FROM import_context) AND x.system_number=i.system_number JOIN public.documents d ON upper(d.library_code)=x.library_code AND d.system_number=x.system_number WHERE x.id<>d.id) THEN RAISE EXCEPTION 'Existing UUID mismatch'; END IF;
END $$;
INSERT INTO import.bib_ids(library_code,system_number,id)
 SELECT (SELECT library FROM import_context),i.system_number,COALESCE(d.id,gen_random_uuid()) FROM document_incoming i
 LEFT JOIN public.documents d ON upper(d.library_code)=(SELECT library FROM import_context) AND d.system_number=i.system_number
 WHERE NOT EXISTS(SELECT 1 FROM import.bib_ids x WHERE x.library_code=(SELECT library FROM import_context) AND x.system_number=i.system_number);
CREATE TEMP TABLE batch_result ON COMMIT DROP AS SELECT 0::bigint inserted,
 count(*) FILTER(WHERE ROW(d.leader,d.format,d.fields) IS NOT DISTINCT FROM ROW(i.leader,i.format,i.fields)) identical,
 count(*) FILTER(WHERE ROW(d.leader,d.format,d.fields) IS DISTINCT FROM ROW(i.leader,i.format,i.fields)) conflicts
 FROM document_incoming i JOIN public.documents d ON upper(d.library_code)=(SELECT library FROM import_context) AND d.system_number=i.system_number;
INSERT INTO import.bib_errors
 SELECT (SELECT archive FROM import_context),(SELECT file FROM import_context),i.line,'existing_conflict',jsonb_build_object('recordId',lpad(i.system_number::text,9,'0'),'byteOffset',i.byte_offset,'byteLength',i.byte_length)::text
 FROM document_incoming i JOIN public.documents d ON upper(d.library_code)=(SELECT library FROM import_context) AND d.system_number=i.system_number
 WHERE ROW(d.leader,d.format,d.fields) IS DISTINCT FROM ROW(i.leader,i.format,i.fields);
WITH added AS (
 INSERT INTO public.documents(id,library_code,system_number,leader,format,fields)
 SELECT x.id,(SELECT library FROM import_context),i.system_number,i.leader,i.format,i.fields FROM document_incoming i
 JOIN import.bib_ids x ON x.library_code=(SELECT library FROM import_context) AND x.system_number=i.system_number
 WHERE NOT EXISTS(SELECT 1 FROM public.documents d WHERE upper(d.library_code)=(SELECT library FROM import_context) AND d.system_number=i.system_number)
 RETURNING 1
) UPDATE batch_result SET inserted=(SELECT count(*) FROM added);
INSERT INTO import.bib_records(source_sha256,library_code,system_number,id,leader,format,byte_offset,byte_length)
 SELECT (SELECT archive FROM import_context),(SELECT library FROM import_context),i.system_number,x.id,i.leader,i.format,i.byte_offset,i.byte_length
 FROM document_incoming i JOIN import.bib_ids x ON x.library_code=(SELECT library FROM import_context) AND x.system_number=i.system_number
 ON CONFLICT(source_sha256,library_code,system_number) DO NOTHING;
INSERT INTO import.bib_batches
 SELECT (SELECT archive FROM import_context),(SELECT file FROM import_context),(SELECT sha FROM import_context),to_jsonb(r)||jsonb_build_object('file',(SELECT file FROM import_context),'rejected',0,'libraryCode',(SELECT library FROM import_context)) FROM batch_result r;
`);
}

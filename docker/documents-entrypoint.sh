#!/bin/sh
set -eu
# exec передаёт PID 1 и сигналы выбранному Node CLI.
# DOC-PREVIEW:/docs/documents-deployment.md#entrypoint · DOC-PREVIEW:/docs/container-commands.md#invoke
# documents publish / worker start --stage publish: DOC-PREVIEW:/docs/bib-publication.md#commands
case "${1:-help}" in
  documents) shift; exec node /app/dist/documents-cli.js "$@" ;;
  worker) shift; exec node /app/dist/documents-worker-cli.js "$@" ;;
  help) exec node /app/dist/documents-cli.js help ;;
  *) echo 'Usage: documents COMMAND | worker COMMAND | help' >&2; exit 2 ;;
esac

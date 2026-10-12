#!/bin/sh
set -eu
# exec передаёт PID 1 и сигналы выбранному Node CLI.
# DOC-PREVIEW:/docs/documents-deployment.md#entrypoint
case "${1:-help}" in
  documents) shift; exec node /app/dist/documents-cli.js "$@" ;;
  worker) shift; exec node /app/dist/documents-worker-cli.js "$@" ;;
  deploy) shift; exec node /app/dist/documents-deploy-cli.js "$@" ;;
  help) exec node /app/dist/documents-cli.js help ;;
  *) echo 'Usage: documents COMMAND | worker COMMAND | deploy COMMAND | help' >&2; exit 2 ;;
esac

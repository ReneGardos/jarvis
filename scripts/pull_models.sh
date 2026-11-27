#!/usr/bin/env bash
# Henter standardmodellerne til Ollama. Tilpas efter din hardware (se docs/INSTALL.md).
set -euo pipefail
cd "$(dirname "$0")/.."
source .env
for m in "${OLLAMA_DEFAULT_MODEL:-qwen2.5:7b-instruct}" "${OLLAMA_LARGE_MODEL:-qwen2.5:14b-instruct}" \
         "${OLLAMA_CODE_MODEL:-qwen2.5-coder:7b}" "${OLLAMA_EMBED_MODEL:-nomic-embed-text}"; do
  echo "==> $m"; docker compose exec ollama ollama pull "$m"
done

#!/usr/bin/env bash
# Henter Piper-stemmer (dansk + engelsk) og forvarmer Whisper-modellen.
set -euo pipefail
cd "$(dirname "$0")/.."
DIR=data/voice-models/piper
mkdir -p "$DIR"
BASE=https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0
fetch() { # sprog/region/navn/kvalitet
  local path="$1" name="$2"
  for ext in onnx onnx.json; do
    [ -f "$DIR/$name.$ext" ] || curl -fL "$BASE/$path/$name.$ext" -o "$DIR/$name.$ext"
  done
}
fetch da/da_DK/talesyntese/medium da_DK-talesyntese-medium
fetch en/en_GB/alan/medium en_GB-alan-medium
echo "Piper-stemmer klar i $DIR"
docker compose exec backend python -c "from app.services.voice import _whisper; _whisper(); print('Whisper klar')" || \
  echo "Whisper downloades automatisk ved første brug."

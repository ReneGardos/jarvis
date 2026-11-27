FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg postgresql-client git curl && rm -rf /var/lib/apt/lists/*

RUN useradd -m -u 1000 jarvis
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
RUN mkdir -p /data/uploads /data/voice-models /data/backups && chown -R jarvis /data /app
USER jarvis

EXPOSE 8000
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers"]

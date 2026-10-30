FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev gcc \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000
# Production: set up the database once (workers would race on it), then start
# the workers without --reload. X-Forwarded-For is trusted from
# FORWARDED_ALLOW_IPS (in deploy/docker-compose.prod.yml only Caddy can reach this port).
ENV WEB_CONCURRENCY=2 FORWARDED_ALLOW_IPS="127.0.0.1"
CMD ["sh", "-c", "python -m app.migrate && exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers ${WEB_CONCURRENCY} --proxy-headers --forwarded-allow-ips \"${FORWARDED_ALLOW_IPS}\""]

FROM python:3.12-slim

WORKDIR /app

# Install deps first for layer caching
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY granbridge_broker/ ./granbridge_broker/

# Non-root runtime user; /secrets is a read mount (written by the init one-shot)
RUN adduser --disabled-password --gecos "" --no-create-home app \
    && mkdir -p /secrets && chown app:app /app
USER app

EXPOSE 8788

# Health: the broker answers /healthz over plain HTTP on the same port
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["python", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8788/healthz', timeout=3).status==200 else 1)"]

CMD ["python", "-m", "granbridge_broker"]

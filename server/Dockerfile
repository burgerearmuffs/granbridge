FROM python:3.12-slim

# Working directory is /app; granbridge_broker/ sits directly inside it
# so `python -m granbridge_broker` resolves correctly.
WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY granbridge_broker/ ./granbridge_broker/

EXPOSE 8788

CMD ["python", "-m", "granbridge_broker"]

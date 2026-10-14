FROM python:3.12-slim
# build with --build-arg EMBEDDINGS=1 to add sentence-transformers (pulls PyTorch, ~2 GB image)
ARG EMBEDDINGS=0
WORKDIR /app
COPY requirements.txt requirements-embeddings.txt ./
RUN pip install --no-cache-dir -r requirements.txt && \
    if [ "$EMBEDDINGS" = "1" ]; then pip install --no-cache-dir -r requirements-embeddings.txt; fi
COPY tracer ./tracer
ENV TRACER_CACHE_DIR=/data TRACER_EMBED=1
VOLUME /data
EXPOSE 8000
CMD ["uvicorn", "tracer.main:app", "--host", "0.0.0.0", "--port", "8000"]

# Runner service (plan: Runner contract). Holds the Docker socket and starts one
# sandbox container per run. Stdlib Python plus the `docker` CLI. Pinned by digest.
FROM docker:27-cli@sha256:851f91d241214e7c6db86513b270d58776379aacc5eb9c4a87e5b47115e3065c AS docker-cli

FROM python:3.12-slim@sha256:a6e34c598f2467ed0e9a8d349809fcd8b5c603269512df273a0bb1784edc11b1

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker
COPY service.py /runner/service.py

# Runs as root: talking to the mounted Docker socket needs it, and socket access is
# root-equivalent on the host anyway. Only the compose network can reach port 8080.
EXPOSE 8080
ENTRYPOINT ["python", "-I", "/runner/service.py"]

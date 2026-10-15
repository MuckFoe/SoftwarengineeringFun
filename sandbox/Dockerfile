# Sandbox image for running solutions (plan: Run pipeline, step 4).
# Pinned by digest; bump deliberately.
FROM python:3.12-slim@sha256:a6e34c598f2467ed0e9a8d349809fcd8b5c603269512df273a0bb1784edc11b1

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

COPY harness.py /sandbox/harness.py

WORKDIR /scratch
USER 65534:65534

ENTRYPOINT ["python", "-I", "/sandbox/harness.py"]

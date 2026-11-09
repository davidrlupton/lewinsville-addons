ARG BUILD_FROM
FROM ${BUILD_FROM}
# Debian, not Alpine: the VAD's onnxruntime wheel needs glibc. alsa-utils + the pulse plugin give arecord/aplay
# through the hub's PulseAudio, exactly as the Assist Microphone add-on does.
ENV PIP_BREAK_SYSTEM_PACKAGES=1 PYTHONUNBUFFERED=1
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip alsa-utils libasound2-plugins \
    && pip3 install --no-cache-dir "wyoming>=1.6,<2" "pysilero-vad>=2,<3" "websockets>=13,<16" \
    && apt-get clean && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY teddy /app/teddy
COPY run.sh /run.sh
RUN chmod +x /run.sh
CMD ["/run.sh"]

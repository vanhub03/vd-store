#!/bin/sh
set -eu

for url in https://www.cloudflare.com https://www.google.com https://api.github.com; do
  date_header=$(curl -fsSI --max-time 10 "$url" | tr -d "\r" | sed -n "s/^[Dd]ate: //p" | head -n1)
  if [ -n "$date_header" ]; then
    date -u -s "$date_header" >/dev/null
    exit 0
  fi
done

exit 1

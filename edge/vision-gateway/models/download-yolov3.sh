#!/usr/bin/env bash
# Downloads the stock YOLOv3 COCO model used for vehicle detection (~237 MB weights).
# For a Raspberry Pi / low-power gateway use yolov3-tiny instead: ./download-yolov3.sh tiny
set -euo pipefail
cd "$(dirname "$0")"
variant="${1:-full}"
curl -fsSL -o coco.names https://raw.githubusercontent.com/pjreddie/darknet/master/data/coco.names
if [ "$variant" = "tiny" ]; then
  curl -fsSL -o yolov3.cfg https://raw.githubusercontent.com/pjreddie/darknet/master/cfg/yolov3-tiny.cfg
  curl -fsSL -o yolov3.weights https://pjreddie.com/media/files/yolov3-tiny.weights
else
  curl -fsSL -o yolov3.cfg https://raw.githubusercontent.com/pjreddie/darknet/master/cfg/yolov3.cfg
  curl -fsSL -o yolov3.weights https://pjreddie.com/media/files/yolov3.weights
fi
echo "Model files ready in $(pwd)"

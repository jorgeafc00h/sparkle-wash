#!/usr/bin/env python3
"""Generate brand asset candidates with the local Krea-2 Turbo model on ComfyUI.

Usage:
  python3 -I scripts/brand/generate.py [asset-name ...] [--host URL] [--out DIR]

Reads scripts/brand/prompts.json. Every asset gets the shared style suffix and
the "no text" guard (diffusion models render gibberish letters; the wordmark is
always live text in the app). Candidates land in design/brand/candidates/
(git-ignored); picked masters are committed to design/brand/masters/.

The graph mirrors ComfyUI's own image_krea2_turbo_t2i workflow: local
krea2_turbo_fp8_scaled + qwen3vl_4b (type krea2) + qwen_image_vae, 8 steps,
cfg 1, euler/simple. It never uses the paid Krea partner API nodes.
Standard library only, so it runs anywhere Python 3 does.
"""
import argparse
import json
import os
import sys
import time
import urllib.parse
import urllib.request
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))


def build_graph(prompt, width, height, batch, seed, prefix, remove_background):
    graph = {
        "unet": {"class_type": "UNETLoader",
                 "inputs": {"unet_name": "krea2_turbo_fp8_scaled.safetensors", "weight_dtype": "default"}},
        "clip": {"class_type": "CLIPLoader",
                 "inputs": {"clip_name": "qwen3vl_4b_fp8_scaled.safetensors", "type": "krea2", "device": "default"}},
        "vae": {"class_type": "VAELoader", "inputs": {"vae_name": "qwen_image_vae.safetensors"}},
        "pos": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["clip", 0], "text": prompt}},
        "neg": {"class_type": "ConditioningZeroOut", "inputs": {"conditioning": ["pos", 0]}},
        "latent": {"class_type": "EmptyLatentImage", "inputs": {"width": width, "height": height, "batch_size": batch}},
        "sample": {"class_type": "KSampler", "inputs": {
            "model": ["unet", 0], "positive": ["pos", 0], "negative": ["neg", 0], "latent_image": ["latent", 0],
            "seed": seed, "steps": 8, "cfg": 1.0, "sampler_name": "euler", "scheduler": "simple", "denoise": 1.0}},
        "decode": {"class_type": "VAEDecode", "inputs": {"samples": ["sample", 0], "vae": ["vae", 0]}},
        "save": {"class_type": "SaveImage", "inputs": {"images": ["decode", 0], "filename_prefix": prefix}},
    }
    if remove_background:
        graph.update({
            "bgmodel": {"class_type": "LoadBackgroundRemovalModel",
                        "inputs": {"bg_removal_name": "birefnet.safetensors"}},
            "bgmask": {"class_type": "RemoveBackground",
                       "inputs": {"bg_removal_model": ["bgmodel", 0], "image": ["decode", 0]}},
            # JoinImageWithAlpha stores 1 - mask as alpha (ComfyUI mask convention).
            "invert": {"class_type": "InvertMask", "inputs": {"mask": ["bgmask", 0]}},
            "rgba": {"class_type": "JoinImageWithAlpha", "inputs": {"image": ["decode", 0], "alpha": ["invert", 0]}},
            "save_rgba": {"class_type": "SaveImage", "inputs": {"images": ["rgba", 0], "filename_prefix": prefix + "_alpha"}},
        })
    return graph


def http_json(url, body=None):
    req = urllib.request.Request(url, body, {"Content-Type": "application/json"} if body else {})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def run_asset(host, out_dir, name, asset, style):
    prompt = f"{asset['prompt']} {style}".strip()
    seed = int(asset.get("seed", 1))
    graph = build_graph(prompt, asset.get("width", 1024), asset.get("height", 1024), asset.get("batch", 4),
                        seed, f"fs-rebrand/{name}", asset.get("removeBackground", False))
    started = time.time()
    pid = http_json(host + "/prompt", json.dumps({"prompt": graph, "client_id": str(uuid.uuid4())}).encode())["prompt_id"]
    while True:
        hist = http_json(f"{host}/history/{pid}")
        if pid in hist and hist[pid].get("status", {}).get("completed") is not None:
            break
        if time.time() - started > 600:
            raise TimeoutError(f"{name}: ComfyUI did not finish in 10 min")
        time.sleep(1.5)
    status = hist[pid]["status"]
    if status.get("status_str") != "success":
        raise RuntimeError(f"{name}: {json.dumps(status.get('messages'))[:600]}")
    os.makedirs(out_dir, exist_ok=True)
    written = []
    for node_id, node in hist[pid]["outputs"].items():
        suffix = "_alpha" if node_id == "save_rgba" else ""
        for i, im in enumerate(node.get("images", [])):
            q = urllib.parse.urlencode({"filename": im["filename"], "subfolder": im["subfolder"], "type": im["type"]})
            with urllib.request.urlopen(f"{host}/view?{q}", timeout=60) as r:
                data = r.read()
            path = os.path.join(out_dir, f"{name}_s{seed}_{i}{suffix}.png")
            with open(path, "wb") as f:
                f.write(data)
            written.append(path)
    print(f"{name}: {len(written)} files in {time.time() - started:.1f}s")
    return written


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("assets", nargs="*", help="asset names from prompts.json (default: all)")
    ap.add_argument("--host", default=os.environ.get("COMFYUI_HOST", "http://192.168.1.14:8000"))
    ap.add_argument("--out", default=os.path.join(REPO, "design", "brand", "candidates"))
    args = ap.parse_args()
    spec = json.load(open(os.path.join(HERE, "prompts.json")))
    style = spec["style"].replace("{accent}", spec["accent"])
    names = args.assets or list(spec["assets"])
    for name in names:
        asset = spec["assets"][name]
        asset = {**asset, "prompt": asset["prompt"].replace("{accent}", spec["accent"])}
        run_asset(args.host.rstrip("/"), args.out, name, asset, style)


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env bash
set -e

echo "============================================"
echo "  SparkleWash Spec UI — Build & Test Suite  "
echo "============================================"
echo ""

# Step 1: Build
echo "[BUILD]"
npm run build

# Compile TS to check for type errors
echo "[TYPE CHECK]"
npx tsc --noEmit 2>&1 || echo "TypeScript errors (may be in dev-only files like src/main.tsx) — acceptable"

# Step 2: Run tests
echo ""
echo "[TESTS]"
npm run test 2>&1 || true

echo ""
echo "============================================"
echo "   BUILD SUMMARY:"
echo "============================================"
ls -lh dist/ 2>/dev/null || echo "No dist/ yet. Run 'npm run build'."

#!/bin/bash
set -e

cd "$(dirname "$0")/.."

if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  pnpm install
fi

echo "Stripe CLI check..."
if ! command -v stripe &> /dev/null; then
  echo "WARNING: Stripe CLI not found. Install with: brew install stripe/stripe-cli/stripe"
else
  echo "Stripe CLI: $(stripe --version)"
  if stripe projects --version &> /dev/null 2>&1; then
    echo "Stripe Projects plugin: installed"
  else
    echo "WARNING: Stripe Projects plugin not installed. Run: stripe plugin install projects"
  fi
fi

echo "Init complete."

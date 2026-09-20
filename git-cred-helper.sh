#!/bin/bash

set -e

echo "========================================"
echo " Git Credential Manager Setup"
echo "========================================"

echo "[1/4] Removing old Microsoft repository..."

sudo rm -f /etc/apt/sources.list.d/microsoft-prod.list

echo "[2/4] Installing prerequisites..."

sudo apt update
sudo apt install -y wget

echo "[3/4] Downloading Git Credential Manager..."

GCM_VERSION="2.9.1"
GCM_PACKAGE="gcm-linux-x64-${GCM_VERSION}.deb"
GCM_URL="https://github.com/git-ecosystem/git-credential-manager/releases/download/v${GCM_VERSION}/${GCM_PACKAGE}"

wget -O "/tmp/${GCM_PACKAGE}" "$GCM_URL"

echo "[4/4] Installing Git Credential Manager..."

sudo dpkg -i "/tmp/${GCM_PACKAGE}"

rm -f "/tmp/${GCM_PACKAGE}"

echo "Configuring Git Credential Manager..."

git-credential-manager configure

echo ""
echo "========================================"
echo " Installation Complete"
echo "========================================"

echo ""
echo "Git version:"
git --version

echo ""
echo "Git Credential Manager version:"
git-credential-manager --version

echo ""
echo "Git credential helper:"
git config --global credential.helper

echo ""
echo "Setup completed successfully."

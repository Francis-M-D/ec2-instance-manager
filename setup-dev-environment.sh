#!/bin/bash

set -e

echo "========================================"
echo " Development Environment Setup"
echo " Ubuntu 22.04"
echo "========================================"

# ----------------------------------------
# 1. Basic prerequisites
# ----------------------------------------

echo ""
echo "[1/7] Installing basic prerequisites..."

sudo apt update

sudo apt install -y \
    curl \
    wget \
    git \
    unzip \
    ca-certificates \
    gnupg \
    lsb-release \
    software-properties-common \
    apt-transport-https

# ----------------------------------------
# 2. Docker + Docker Compose
# ----------------------------------------

echo ""
echo "[2/7] Installing Docker..."

if command -v docker >/dev/null 2>&1; then
    echo "Docker is already installed."
else
    sudo install -m 0755 -d /etc/apt/keyrings

    sudo curl -fsSL \
        https://download.docker.com/linux/ubuntu/gpg \
        -o /etc/apt/keyrings/docker.asc

    sudo chmod a+r /etc/apt/keyrings/docker.asc

    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
      https://download.docker.com/linux/ubuntu \
      $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}") stable" | \
      sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

    sudo apt update

    sudo apt install -y \
        docker-ce \
        docker-ce-cli \
        containerd.io \
        docker-buildx-plugin \
        docker-compose-plugin
fi

echo "Enabling Docker..."

sudo systemctl enable --now docker

# Allow current user to run Docker without sudo
sudo usermod -aG docker "$USER"

echo "Docker installation completed."

# ----------------------------------------
# 3. .NET SDK 8
# ----------------------------------------

echo ""
echo "[3/7] Installing .NET SDK 8..."

if command -v dotnet >/dev/null 2>&1 && \
   dotnet --list-sdks | grep -q "^8\."; then

    echo ".NET SDK 8 is already installed."

else

    wget -q https://packages.microsoft.com/config/ubuntu/22.04/packages-microsoft-prod.deb \
        -O /tmp/packages-microsoft-prod.deb

    sudo dpkg -i /tmp/packages-microsoft-prod.deb

    rm -f /tmp/packages-microsoft-prod.deb

    sudo apt update

    sudo apt install -y dotnet-sdk-8.0

fi

# ----------------------------------------
# 4. Python 3.11+
# ----------------------------------------

echo ""
echo "[4/7] Installing Python 3.11..."

if command -v python3.11 >/dev/null 2>&1; then

    echo "Python 3.11 is already installed."

else

    sudo add-apt-repository -y ppa:deadsnakes/ppa

    sudo apt update

    sudo apt install -y \
        python3.11 \
        python3.11-venv \
        python3.11-dev

fi

# ----------------------------------------
# 5. Node.js 20+
# ----------------------------------------

echo ""
echo "[5/7] Installing Node.js 20..."

if command -v node >/dev/null 2>&1 && \
   node --version | grep -qE '^v(20|21|22|23|24|25)\.'; then

    echo "Node.js 20+ is already installed."

else

    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -

    sudo apt install -y nodejs

fi

# ----------------------------------------
# 6. Verification
# ----------------------------------------

echo ""
echo "[6/7] Verifying installations..."

echo ""
echo "Docker:"
docker --version

echo ""
echo "Docker Compose:"
docker compose version

echo ""
echo ".NET:"
dotnet --version

echo ""
echo "Python:"
python3.11 --version

echo ""
echo "Node.js:"
node --version

echo ""
echo "NPM:"
npm --version

# ----------------------------------------
# 7. Final information
# ----------------------------------------

echo ""
echo "[7/7] Setup summary"

echo ""
echo "========================================"
echo " Installation Complete"
echo "========================================"

echo ""
echo "Installed:"
echo "  - Docker"
echo "  - Docker Compose"
echo "  - .NET SDK 8"
echo "  - Python 3.11"
echo "  - Node.js 20+"
echo "  - Git"
echo "  - Basic development tools"

echo ""
echo "Not installed/configured:"
echo "  - AWS IAM"
echo "  - AWS accounts"
echo "  - MySQL server"
echo ""
echo "MySQL should normally be started through"
echo "Docker Compose for this project."

echo ""
echo "IMPORTANT:"
echo "Log out and log back in (or start a new SSH session)"
echo "for the Docker group change to take effect."

echo ""
echo "After reconnecting, test Docker with:"
echo "  docker run hello-world"

echo ""
echo "========================================"

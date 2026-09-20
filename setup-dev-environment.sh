#!/usr/bin/env bash

# ============================================================
# Full-Stack Development Environment Setup
# ============================================================
#
# Target:
#   Ubuntu 22.04
#
# Installs:
#   Git
#   Python 3.11
#   Python pip
#   Python venv
#   Python development headers
#   Node.js 20
#   npm / npx
#   .NET SDK 8
#   Docker Engine
#   Docker Compose
#   Docker Buildx
#   AWS CLI
#   Common development tools
#
# Does NOT install:
#   MySQL
#
# MySQL should normally run through Docker Compose.
#
# ============================================================

set -Eeuo pipefail

# ------------------------------------------------------------
# Configuration
# ------------------------------------------------------------

PYTHON_VERSION="3.11"
NODE_MAJOR_VERSION="20"
DOTNET_VERSION="8.0"

# ------------------------------------------------------------
# Colors
# ------------------------------------------------------------

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# ------------------------------------------------------------
# Functions
# ------------------------------------------------------------

info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

success() {
    echo -e "${GREEN}[OK]${NC} $1"
}

warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

section() {
    echo
    echo "============================================================"
    echo "$1"
    echo "============================================================"
    echo
}

# ------------------------------------------------------------
# Error handler
# ------------------------------------------------------------

trap 'error "Setup failed on line $LINENO."; exit 1' ERR

# ------------------------------------------------------------
# Check root
# ------------------------------------------------------------

if [ "$EUID" -eq 0 ]; then
    error "Do not run this script as root."
    echo
    echo "Run it as your normal Ubuntu user:"
    echo
    echo "    ./setup-dev-environment.sh"
    echo
    exit 1
fi

# ------------------------------------------------------------
# Check OS
# ------------------------------------------------------------

section "Checking Operating System"

if [ ! -f /etc/os-release ]; then
    error "Cannot determine the operating system."
    exit 1
fi

source /etc/os-release

echo "Distribution : ${PRETTY_NAME:-unknown}"
echo "Version      : ${VERSION_ID:-unknown}"
echo "Codename     : ${VERSION_CODENAME:-unknown}"
echo

if [ "${ID:-}" != "ubuntu" ]; then
    warning "This script is designed for Ubuntu."
    warning "Detected: ${ID:-unknown}"
fi

if [ "${VERSION_ID:-}" != "22.04" ]; then
    warning "This script was written for Ubuntu 22.04."
    warning "Detected Ubuntu version: ${VERSION_ID:-unknown}"
fi

# ------------------------------------------------------------
# Check sudo
# ------------------------------------------------------------

if ! command -v sudo >/dev/null 2>&1; then
    error "sudo is not installed."
    exit 1
fi

# ============================================================
# SYSTEM UPDATE
# ============================================================

section "Updating Ubuntu"

sudo apt-get update

success "Package lists updated."

# ============================================================
# COMMON DEVELOPMENT TOOLS
# ============================================================

section "Installing Common Development Tools"

sudo apt-get install -y \
    ca-certificates \
    curl \
    wget \
    gnupg \
    gpg \
    lsb-release \
    apt-transport-https \
    software-properties-common \
    unzip \
    zip \
    jq \
    tree \
    vim \
    nano \
    htop \
    net-tools \
    dnsutils \
    openssh-client \
    build-essential \
    pkg-config \
    make \
    gcc \
    g++ \
    git

success "Common development tools installed."

# ============================================================
# PYTHON 3.11
# ============================================================

section "Installing Python ${PYTHON_VERSION}"

# Ubuntu 22.04 does not provide Python 3.11 as its default
# Python version, so use the deadsnakes PPA.

if ! command -v python3.11 >/dev/null 2>&1; then

    info "Adding Python repository..."

    sudo add-apt-repository -y ppa:deadsnakes/ppa

    sudo apt-get update

    info "Installing Python ${PYTHON_VERSION}..."

    sudo apt-get install -y \
        python3.11 \
        python3.11-pip \
        python3.11-venv \
        python3.11-dev

else

    info "Python 3.11 is already installed."

fi

success "Python: $(python3.11 --version)"

# ------------------------------------------------------------
# Python pip
# ------------------------------------------------------------

section "Configuring Python pip"

if command -v pip3.11 >/dev/null 2>&1; then

    success "pip: $(pip3.11 --version)"

else

    warning "pip3.11 command was not found."

fi

# ------------------------------------------------------------
# Python development libraries
# ------------------------------------------------------------

sudo apt-get install -y \
    libssl-dev \
    libffi-dev \
    libbz2-dev \
    libreadline-dev \
    libsqlite3-dev \
    liblzma-dev \
    libncurses5-dev \
    libncursesw5-dev \
    zlib1g-dev \
    tk-dev \
    xz-utils

success "Python development libraries installed."

# ------------------------------------------------------------
# Verify Python venv
# ------------------------------------------------------------

if python3.11 -m venv --help >/dev/null 2>&1; then

    success "Python venv is available."

else

    error "Python venv is not working."
    exit 1

fi

# ============================================================
# NODE.JS 20
# ============================================================

section "Installing Node.js ${NODE_MAJOR_VERSION}"

if command -v node >/dev/null 2>&1 && \
   node --version | grep -qE '^v(20|21|22|23|24|25)\.'; then

    info "Node.js 20+ is already installed."

else

    info "Installing Node.js ${NODE_MAJOR_VERSION}.x..."

    curl -fsSL \
        "https://deb.nodesource.com/setup_${NODE_MAJOR_VERSION}.x" \
        | sudo -E bash -

    sudo apt-get install -y nodejs

fi

success "Node.js: $(node --version)"
success "npm: $(npm --version)"
success "npx: $(npx --version)"

# ============================================================
# .NET SDK 8
# ============================================================

section "Installing .NET SDK ${DOTNET_VERSION}"

if command -v dotnet >/dev/null 2>&1 && \
   dotnet --list-sdks | grep -q "^${DOTNET_VERSION}\."; then

    info ".NET SDK ${DOTNET_VERSION} is already installed."

else

    info "Adding Microsoft package repository..."

    wget -q \
        https://packages.microsoft.com/config/ubuntu/22.04/packages-microsoft-prod.deb \
        -O /tmp/packages-microsoft-prod.deb

    sudo dpkg -i /tmp/packages-microsoft-prod.deb

    rm -f /tmp/packages-microsoft-prod.deb

    sudo apt-get update

    info "Installing .NET SDK ${DOTNET_VERSION}..."

    sudo apt-get install -y "dotnet-sdk-${DOTNET_VERSION}"

fi

success ".NET SDK: $(dotnet --version)"

# ============================================================
# DOCKER
# ============================================================

section "Installing Docker"

# ------------------------------------------------------------
# Remove conflicting packages
# ------------------------------------------------------------

sudo apt-get remove -y \
    docker.io \
    docker-doc \
    docker-compose \
    docker-compose-v2 \
    podman-docker \
    containerd \
    runc \
    2>/dev/null || true

# ------------------------------------------------------------
# Docker repository
# ------------------------------------------------------------

sudo install -m 0755 -d /etc/apt/keyrings

if [ ! -f /etc/apt/keyrings/docker.asc ]; then

    info "Adding Docker GPG key..."

    sudo curl -fsSL \
        https://download.docker.com/linux/ubuntu/gpg \
        -o /etc/apt/keyrings/docker.asc

fi

sudo chmod a+r /etc/apt/keyrings/docker.asc

DOCKER_CODENAME="${UBUNTU_CODENAME:-${VERSION_CODENAME:-}}"

if [ -z "$DOCKER_CODENAME" ]; then

    error "Unable to determine Ubuntu codename."
    exit 1

fi

echo \
"deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/ubuntu \
${DOCKER_CODENAME} stable" \
| sudo tee /etc/apt/sources.list.d/docker.list >/dev/null

sudo apt-get update

# ------------------------------------------------------------
# Docker packages
# ------------------------------------------------------------

sudo apt-get install -y \
    docker-ce \
    docker-ce-cli \
    containerd.io \
    docker-buildx-plugin \
    docker-compose-plugin

success "Docker: $(docker --version)"
success "Docker Compose: $(docker compose version)"
success "Docker Buildx: $(docker buildx version)"

# ------------------------------------------------------------
# Docker service
# ------------------------------------------------------------

if command -v systemctl >/dev/null 2>&1; then

    sudo systemctl enable docker
    sudo systemctl start docker

    success "Docker service is enabled and running."

fi

# ------------------------------------------------------------
# Docker group
# ------------------------------------------------------------

section "Configuring Docker Group"

if ! getent group docker >/dev/null 2>&1; then

    sudo groupadd docker

    success "Created docker group."

else

    info "Docker group already exists."

fi

if id -nG "$USER" | grep -qw docker; then

    info "$USER is already a member of the docker group."
	newgrp docker

else

    sudo usermod -aG docker "$USER"
	newgrp docker
    success "Added $USER to the docker group."

fi

# ============================================================
# AWS CLI
# ============================================================

section "Installing AWS CLI"

if command -v aws >/dev/null 2>&1; then

    info "AWS CLI is already installed."

else

    ARCH=$(dpkg --print-architecture)

    case "$ARCH" in

        amd64)
            AWS_URL="https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip"
            ;;

        arm64)
            AWS_URL="https://awscli.amazonaws.com/awscli-exe-linux-aarch64.zip"
            ;;

        *)
            error "Unsupported architecture: $ARCH"
            exit 1
            ;;

    esac

    TMP_DIR=$(mktemp -d)

    curl -fsSL "$AWS_URL" \
        -o "$TMP_DIR/awscliv2.zip"

    unzip -q "$TMP_DIR/awscliv2.zip" \
        -d "$TMP_DIR"

    sudo "$TMP_DIR/aws/install"

    rm -rf "$TMP_DIR"

fi

success "AWS CLI: $(aws --version)"

# ============================================================
# FINAL VERIFICATION
# ============================================================

section "Final Installation Verification"

echo "Git:"
git --version

echo
echo "Python:"
python3.11 --version

echo
echo "pip:"
pip --version

echo
echo "Python venv:"
python3.11 -m venv --help >/dev/null && echo "available"

echo
echo "Node.js:"
node --version

echo
echo "npm:"
npm --version

echo
echo "npx:"
npx --version

echo
echo ".NET:"
dotnet --version

echo
echo "Docker:"
docker --version

echo
echo "Docker Compose:"
docker compose version

echo
echo "Docker Buildx:"
docker buildx version

echo
echo "AWS CLI:"
aws --version

echo
echo "Docker group:"
if id -nG "$USER" | grep -qw docker; then
    echo "$USER is a member of the docker group."
else
    echo "$USER will be a member of the docker group after logging in again."
fi

# ============================================================
# FINAL INFORMATION
# ============================================================

section "Setup Complete"

echo -e "${GREEN}Development environment setup completed.${NC}"

echo
echo "Installed:"
echo
echo "  Git"
echo "  Python ${PYTHON_VERSION}"
echo "  Python pip"
echo "  Python venv"
echo "  Python development headers"
echo "  Node.js ${NODE_MAJOR_VERSION}+"
echo "  npm"
echo "  npx"
echo "  .NET SDK ${DOTNET_VERSION}"
echo "  Docker Engine"
echo "  Docker Compose"
echo "  Docker Buildx"
echo "  AWS CLI"
echo

echo "Not installed:"
echo
echo "  MySQL"
echo
echo "MySQL should be started through Docker Compose."
echo

echo "============================================================"
echo "IMPORTANT: Docker group"
echo "============================================================"
echo
echo "The user '$USER' has been added to the docker group."
echo
echo "Start a new SSH session before running Docker without sudo."
echo
echo "Then verify with:"
echo
echo "    groups"
echo
echo "    docker run hello-world"
echo

echo "============================================================"
echo "USEFUL COMMANDS"
echo "============================================================"
echo
echo "Python:"
echo "    python3.11 --version"
echo "    pip3.11 --version"
echo
echo "Node:"
echo "    node --version"
echo "    npm --version"
echo
echo ".NET:"
echo "    dotnet --version"
echo
echo "Docker:"
echo "    docker --version"
echo "    docker compose version"
echo "    docker ps"
echo
echo "AWS:"
echo "    aws --version"
echo "    aws sts get-caller-identity"
echo

echo "============================================================"
echo "DONE"
echo "============================================================"

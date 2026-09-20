#!/usr/bin/env bash

set -Eeuo pipefail

# ============================================================
# EC2 Manager - One Command Setup
# ============================================================

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INFRA_DIR="$PROJECT_ROOT/infra"

BACKEND_DIR="$PROJECT_ROOT/backend"
CLOUD_DIR="$PROJECT_ROOT/cloud-service"
FRONTEND_DIR="$PROJECT_ROOT/frontend"

COMPOSE_FILE="$INFRA_DIR/docker-compose.yml"

log() {
    echo
    echo "============================================================"
    echo "$1"
    echo "============================================================"
}

fail() {
    echo
    echo "[ERROR] $1"
    exit 1
}

# ------------------------------------------------------------
# Basic checks
# ------------------------------------------------------------

[[ "$EUID" -eq 0 ]] && fail "Do not run this script as root. Run it as your normal user."

cd "$PROJECT_ROOT"

log "EC2 Manager Setup"

echo "Project root: $PROJECT_ROOT"
echo

# ------------------------------------------------------------
# Step 1 - Run mandatory software installation
# ------------------------------------------------------------

log "Step 1/9 - Installing/checking mandatory software"

SETUP_SCRIPT="$PROJECT_ROOT/setup-dev-environment.sh"

if [[ -f "$SETUP_SCRIPT" ]]; then
    chmod +x "$SETUP_SCRIPT"

    echo "[INFO] Running setup-dev-environment.sh..."
    "$SETUP_SCRIPT"
else
    echo "[WARNING] setup-dev-environment.sh not found."
    echo "[INFO] Continuing with existing software..."
fi

# ------------------------------------------------------------
# Step 2 - Verify required commands
# ------------------------------------------------------------

log "Step 2/9 - Verifying required software"

command -v docker >/dev/null 2>&1 \
    || fail "Docker is not installed or not available in PATH."

docker compose version >/dev/null 2>&1 \
    || fail "Docker Compose is not available."

command -v python3 >/dev/null 2>&1 \
    || fail "Python 3 is not installed."

command -v dotnet >/dev/null 2>&1 \
    || fail ".NET SDK is not installed."

echo "[OK] Docker:"
docker --version

echo "[OK] Docker Compose:"
docker compose version

echo "[OK] Python:"
python3 --version

echo "[OK] .NET:"
dotnet --version

# ------------------------------------------------------------
# Step 3 - Create .env files if missing
# ------------------------------------------------------------

log "Step 3/9 - Preparing environment files"

create_env_if_missing() {
    local directory="$1"

    if [[ -f "$directory/.env" ]]; then
        echo "[OK] $directory/.env already exists"
        return
    fi

    if [[ -f "$directory/.env.example" ]]; then
        cp "$directory/.env.example" "$directory/.env"
        echo "[CREATED] $directory/.env from .env.example"
    else
        echo "[WARNING] No .env.example found in $directory"
    fi
}

create_env_if_missing "$BACKEND_DIR"
create_env_if_missing "$CLOUD_DIR"
create_env_if_missing "$FRONTEND_DIR"

# ------------------------------------------------------------
# Step 4 - Configure frontend
# ------------------------------------------------------------

log "Step 4/9 - Configuring frontend"

FRONTEND_ENV="$FRONTEND_DIR/.env"

if [[ -f "$FRONTEND_ENV" ]]; then

    if grep -q '^VITE_API_BASE_URL=' "$FRONTEND_ENV"; then
        sed -i 's|^VITE_API_BASE_URL=.*|VITE_API_BASE_URL=/api|' "$FRONTEND_ENV"
    else
        echo "VITE_API_BASE_URL=/api" >> "$FRONTEND_ENV"
    fi

    echo "[OK] Frontend configured to use /api"
else
    cat > "$FRONTEND_ENV" <<'EOF'
VITE_API_BASE_URL=/api
EOF

    echo "[CREATED] frontend/.env"
fi

# ------------------------------------------------------------
# Step 5 - Configure initial administrator
# ------------------------------------------------------------

log "Step 5/9 - Checking initial administrator configuration"

BACKEND_ENV="$BACKEND_DIR/.env"

if [[ ! -f "$BACKEND_ENV" ]]; then
    fail "backend/.env does not exist."
fi

get_env_value() {
    local key="$1"

    grep "^${key}=" "$BACKEND_ENV" \
        | tail -n 1 \
        | cut -d '=' -f 2-
}

ADMIN_USERNAME="$(get_env_value "EC2MANAGER_INITIAL_ADMIN_USERNAME")"
ADMIN_PASSWORD="$(get_env_value "EC2MANAGER_INITIAL_ADMIN_PASSWORD")"
ADMIN_EMAIL="$(get_env_value "EC2MANAGER_INITIAL_ADMIN_EMAIL")"

if [[ -z "$ADMIN_USERNAME" ]]; then
    read -r -p "Initial admin username [admin]: " ADMIN_USERNAME
    ADMIN_USERNAME="${ADMIN_USERNAME:-admin}"

    if grep -q '^EC2MANAGER_INITIAL_ADMIN_USERNAME=' "$BACKEND_ENV"; then
        sed -i "s|^EC2MANAGER_INITIAL_ADMIN_USERNAME=.*|EC2MANAGER_INITIAL_ADMIN_USERNAME=$ADMIN_USERNAME|" "$BACKEND_ENV"
    else
        echo "EC2MANAGER_INITIAL_ADMIN_USERNAME=$ADMIN_USERNAME" >> "$BACKEND_ENV"
    fi
fi

if [[ -z "$ADMIN_EMAIL" ]]; then
    read -r -p "Initial admin email [admin@example.com]: " ADMIN_EMAIL
    ADMIN_EMAIL="${ADMIN_EMAIL:-admin@example.com}"

    if grep -q '^EC2MANAGER_INITIAL_ADMIN_EMAIL=' "$BACKEND_ENV"; then
        sed -i "s|^EC2MANAGER_INITIAL_ADMIN_EMAIL=.*|EC2MANAGER_INITIAL_ADMIN_EMAIL=$ADMIN_EMAIL|" "$BACKEND_ENV"
    else
        echo "EC2MANAGER_INITIAL_ADMIN_EMAIL=$ADMIN_EMAIL" >> "$BACKEND_ENV"
    fi
fi

if [[ -z "$ADMIN_PASSWORD" ]]; then
    while true; do
        read -r -s -p "Initial admin password: " ADMIN_PASSWORD
        echo

        read -r -s -p "Confirm admin password: " ADMIN_PASSWORD_CONFIRM
        echo

        if [[ "$ADMIN_PASSWORD" != "$ADMIN_PASSWORD_CONFIRM" ]]; then
            echo "[ERROR] Passwords do not match."
            continue
        fi

        if [[ ${#ADMIN_PASSWORD} -lt 12 ]]; then
            echo "[ERROR] Password must be at least 12 characters."
            continue
        fi

        if [[ ! "$ADMIN_PASSWORD" =~ [A-Z] ]]; then
            echo "[ERROR] Password must contain an uppercase letter."
            continue
        fi

        if [[ ! "$ADMIN_PASSWORD" =~ [a-z] ]]; then
            echo "[ERROR] Password must contain a lowercase letter."
            continue
        fi

        if [[ ! "$ADMIN_PASSWORD" =~ [0-9] ]]; then
            echo "[ERROR] Password must contain a digit."
            continue
        fi

        break
    done

    if grep -q '^EC2MANAGER_INITIAL_ADMIN_PASSWORD=' "$BACKEND_ENV"; then
        sed -i "s|^EC2MANAGER_INITIAL_ADMIN_PASSWORD=.*|EC2MANAGER_INITIAL_ADMIN_PASSWORD=$ADMIN_PASSWORD|" "$BACKEND_ENV"
    else
        echo "EC2MANAGER_INITIAL_ADMIN_PASSWORD=$ADMIN_PASSWORD" >> "$BACKEND_ENV"
    fi
fi

echo "[OK] Initial administrator configuration is present."

# ------------------------------------------------------------
# Step 6 - Generate encrypted AWS configuration
# ------------------------------------------------------------

log "Step 6/9 - AWS encrypted configuration"

AWS_GENERATOR="$CLOUD_DIR/generate_encrypted_config.py"

if [[ ! -f "$AWS_GENERATOR" ]]; then
    fail "AWS configuration generator not found: $AWS_GENERATOR"
fi

echo
echo "[INFO] Checking encrypted AWS configuration..."

CLOUD_KEY="$(grep '^EC2MANAGER_DECRYPTION_KEY=' "$CLOUD_DIR/.env" 2>/dev/null | cut -d '=' -f 2- || true)"
CLOUD_CONFIG="$(grep '^EC2MANAGER_AWS_ACCOUNTS_ENCRYPTED=' "$CLOUD_DIR/.env" 2>/dev/null | cut -d '=' -f 2- || true)"

if [[ -z "$CLOUD_KEY" || -z "$CLOUD_CONFIG" ]]; then

    echo
    echo "AWS encrypted configuration is missing."
    echo "The project generator will now run."
    echo

    cd "$CLOUD_DIR"

    python3 generate_encrypted_config.py

    echo
    echo "[IMPORTANT]"
    echo "Copy the generated:"
    echo "  EC2MANAGER_DECRYPTION_KEY"
    echo "  EC2MANAGER_AWS_ACCOUNTS_ENCRYPTED"
    echo
    echo "into BOTH:"
    echo "  cloud-service/.env"
    echo "  backend/.env"
    echo

    read -r -p "Press ENTER after both .env files have been updated..."

else
    echo "[OK] Encrypted AWS configuration already exists."
fi

cd "$PROJECT_ROOT"

# ------------------------------------------------------------
# Step 7 - Install EF Core CLI and migrate database
# ------------------------------------------------------------

log "Step 7/9 - Preparing and migrating database"

if ! command -v dotnet-ef >/dev/null 2>&1; then
    echo "[INFO] dotnet-ef not found."

    dotnet tool install --global dotnet-ef

    export PATH="$PATH:$HOME/.dotnet/tools"
else
    echo "[OK] dotnet-ef already installed."
fi

command -v dotnet-ef >/dev/null 2>&1 \
    || fail "dotnet-ef installation failed."

echo "[OK] dotnet-ef:"
dotnet ef --version

# Start only MySQL first.
cd "$INFRA_DIR"

echo
echo "[INFO] Starting MySQL..."

docker compose up -d mysql

echo
echo "[INFO] Waiting for MySQL to become healthy..."

for i in {1..60}; do

    STATUS="$(docker inspect \
        --format='{{.State.Health.Status}}' \
        infra-mysql-1 2>/dev/null || true)"

    if [[ "$STATUS" == "healthy" ]]; then
        echo "[OK] MySQL is healthy."
        break
    fi

    if [[ "$i" -eq 60 ]]; then
        docker logs infra-mysql-1
        fail "MySQL did not become healthy within the expected time."
    fi

    sleep 2
done

# Apply existing EF migrations.
cd "$BACKEND_DIR"

export EC2MANAGER_DB_CONNECTION="Server=127.0.0.1;Port=3306;Database=ec2manager;User=root;Password=root;"

echo
echo "[INFO] Applying Entity Framework migrations..."

dotnet ef database update

echo "[OK] Database migrations applied."

cd "$PROJECT_ROOT"

# ------------------------------------------------------------
# Step 8 - Build and start everything
# ------------------------------------------------------------

log "Step 8/9 - Building and starting Docker services"

cd "$INFRA_DIR"

docker compose up -d --build

echo
echo "[INFO] Waiting for containers..."

sleep 5

docker compose ps

# ------------------------------------------------------------
# Step 9 - Final verification
# ------------------------------------------------------------

log "Step 9/9 - Final verification"

echo
echo "Docker containers:"
docker compose ps

echo
echo "Application endpoints:"
echo "  Frontend:      http://<EC2-PUBLIC-IP>/"
echo "  Backend API:   http://<EC2-PUBLIC-IP>/api/"
echo "  Backend docs:  http://<EC2-PUBLIC-IP>/swagger"
echo

echo "============================================================"
echo "EC2 Manager setup completed."
echo "============================================================"
echo

echo "[IMPORTANT]"
echo "If the initial administrator was created successfully,"
echo "remove EC2MANAGER_INITIAL_ADMIN_PASSWORD from:"
echo
echo "  $BACKEND_ENV"
echo
echo "Do NOT commit .env files to Git."
echo

#!/usr/bin/env bash
#
# setup-ec2-manager.sh
# Builds the complete EC2 Instance Manager environment in a fresh AWS account:
#   VPC, public subnet, IGW, route table, security group, key pair,
#   Hub role, Execution role, instance profile, hub EC2 instance
#   (+ optional test target instance).
#
# Safe to re-run: existing resources are detected and reused.
#
# Usage:
#   ./setup-ec2-manager.sh
#   CREATE_TARGET=true ./setup-ec2-manager.sh        # also launch a test target
#   INSTANCE_TYPE=t3.medium ROOT_VOLUME_GB=30 ./setup-ec2-manager.sh
#   APP_CIDR=0.0.0.0/0 ./setup-ec2-manager.sh        # open app ports to everyone
#
# Defaults: t3.small, 20 GB gp3 root volume, TCP 22/80/5173/8080/8000/8001
# allowed from your current public IP only.
#
set -euo pipefail

# ----------------------------- Configuration -----------------------------
REGION="${AWS_REGION:-ap-south-1}"
AZ="${AZ:-${REGION}a}"
INSTANCE_TYPE="${INSTANCE_TYPE:-t3.small}"
ROOT_VOLUME_GB="${ROOT_VOLUME_GB:-20}"
ROOT_DEVICE_NAME="/dev/sda1"                    # root device name for Ubuntu AMIs
SSH_PORT=22
APP_PORTS=(80 5173 8080 8000 8001)              # extra ports opened on the security group
# Who may connect. Default: only your current public IP. To open the app ports
# to everyone, run:  APP_CIDR=0.0.0.0/0 ./setup-ec2-manager.sh
SSH_CIDR="${SSH_CIDR:-}"
APP_CIDR="${APP_CIDR:-}"
CREATE_TARGET="${CREATE_TARGET:-false}"
TARGET_DNS_TAG="${TARGET_DNS_TAG:-No}"          # value of DNS tag on the test target

VPC_NAME="ec2-manager-vpc"
SUBNET_NAME="ec2-manager-public"
IGW_NAME="ec2-manager-igw"
RT_NAME="ec2-manager-rt"
SG_NAME="ec2-manager-sg"
KEY_NAME="ec2-manager-key"
KEY_FILE="./${KEY_NAME}.pem"
HUB_ROLE="Ec2ManagerHubRole"
EXEC_ROLE="Ec2ManagerExecutionRole"
PROFILE_NAME="Ec2ManagerHubInstanceProfile"
HUB_NAME="ec2-manager-hub"
TARGET_NAME="test-target"
ENV_FILE="./ec2-manager.env"

VPC_CIDR="10.0.0.0/16"
SUBNET_CIDR="10.0.1.0/24"
UBUNTU_AMI_PARAM="/aws/service/canonical/ubuntu/server/22.04/stable/current/amd64/hvm/ebs-gp2/ami-id"

export AWS_DEFAULT_REGION="$REGION"
export AWS_PAGER=""

# ------------------------------- Helpers ---------------------------------
log()  { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
info() { printf '    %s\n' "$*"; }
warn() { printf '\033[1;33m    ! %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

# Run a command and turn the CLI's "None" output into an empty string
lookup() {
  local v
  v=$("$@" 2>/dev/null || true)
  if [[ "$v" == "None" ]]; then v=""; fi
  printf '%s' "$v"
}

# ------------------------------ Preflight --------------------------------
command -v aws  >/dev/null 2>&1 || die "AWS CLI not found. Install AWS CLI v2 first."
command -v curl >/dev/null 2>&1 || die "curl not found."

log "Checking AWS credentials"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text 2>/dev/null) \
  || die "Cannot call AWS. Run 'aws configure' with an admin IAM user's keys."
CALLER_ARN=$(aws sts get-caller-identity --query Arn --output text)
info "Account: $ACCOUNT_ID"
info "Caller : $CALLER_ARN"
info "Region : $REGION"
if [[ "$CALLER_ARN" == *":root" ]]; then
  warn "You are running as the root user. An admin IAM user is recommended."
fi

# ------------------------------ 1. Network -------------------------------
log "Step 1/6: Networking"

VPC_ID=$(lookup aws ec2 describe-vpcs \
  --filters "Name=tag:Name,Values=$VPC_NAME" \
  --query 'Vpcs[0].VpcId' --output text)
if [[ -z "$VPC_ID" ]]; then
  VPC_ID=$(aws ec2 create-vpc --cidr-block "$VPC_CIDR" \
    --tag-specifications "ResourceType=vpc,Tags=[{Key=Name,Value=$VPC_NAME}]" \
    --query Vpc.VpcId --output text)
  aws ec2 modify-vpc-attribute --vpc-id "$VPC_ID" --enable-dns-hostnames
  aws ec2 modify-vpc-attribute --vpc-id "$VPC_ID" --enable-dns-support
  info "Created VPC $VPC_ID"
else
  info "Reusing VPC $VPC_ID"
fi

SUBNET_ID=$(lookup aws ec2 describe-subnets \
  --filters "Name=tag:Name,Values=$SUBNET_NAME" "Name=vpc-id,Values=$VPC_ID" \
  --query 'Subnets[0].SubnetId' --output text)
if [[ -z "$SUBNET_ID" ]]; then
  SUBNET_ID=$(aws ec2 create-subnet --vpc-id "$VPC_ID" \
    --cidr-block "$SUBNET_CIDR" --availability-zone "$AZ" \
    --tag-specifications "ResourceType=subnet,Tags=[{Key=Name,Value=$SUBNET_NAME}]" \
    --query Subnet.SubnetId --output text)
  aws ec2 modify-subnet-attribute --subnet-id "$SUBNET_ID" --map-public-ip-on-launch
  info "Created subnet $SUBNET_ID"
else
  info "Reusing subnet $SUBNET_ID"
fi

IGW_ID=$(lookup aws ec2 describe-internet-gateways \
  --filters "Name=tag:Name,Values=$IGW_NAME" \
  --query 'InternetGateways[0].InternetGatewayId' --output text)
if [[ -z "$IGW_ID" ]]; then
  IGW_ID=$(aws ec2 create-internet-gateway \
    --tag-specifications "ResourceType=internet-gateway,Tags=[{Key=Name,Value=$IGW_NAME}]" \
    --query InternetGateway.InternetGatewayId --output text)
  info "Created internet gateway $IGW_ID"
else
  info "Reusing internet gateway $IGW_ID"
fi
IGW_ATTACHED_VPC=$(lookup aws ec2 describe-internet-gateways --internet-gateway-ids "$IGW_ID" \
  --query 'InternetGateways[0].Attachments[0].VpcId' --output text)
if [[ "$IGW_ATTACHED_VPC" != "$VPC_ID" ]]; then
  aws ec2 attach-internet-gateway --internet-gateway-id "$IGW_ID" --vpc-id "$VPC_ID"
  info "Attached $IGW_ID to $VPC_ID"
fi

RT_ID=$(lookup aws ec2 describe-route-tables \
  --filters "Name=tag:Name,Values=$RT_NAME" "Name=vpc-id,Values=$VPC_ID" \
  --query 'RouteTables[0].RouteTableId' --output text)
if [[ -z "$RT_ID" ]]; then
  RT_ID=$(aws ec2 create-route-table --vpc-id "$VPC_ID" \
    --tag-specifications "ResourceType=route-table,Tags=[{Key=Name,Value=$RT_NAME}]" \
    --query RouteTable.RouteTableId --output text)
  info "Created route table $RT_ID"
else
  info "Reusing route table $RT_ID"
fi
aws ec2 create-route --route-table-id "$RT_ID" \
  --destination-cidr-block 0.0.0.0/0 --gateway-id "$IGW_ID" >/dev/null 2>&1 \
  || info "Default route already exists"
aws ec2 associate-route-table --route-table-id "$RT_ID" --subnet-id "$SUBNET_ID" >/dev/null 2>&1 \
  || info "Subnet already associated with route table"

MY_IP="${MY_IP:-$(curl -s https://checkip.amazonaws.com | tr -d '[:space:]')}"
[[ -n "$MY_IP" ]] || die "Could not detect your public IP. Set MY_IP=x.x.x.x and retry."

SG_ID=$(lookup aws ec2 describe-security-groups \
  --filters "Name=group-name,Values=$SG_NAME" "Name=vpc-id,Values=$VPC_ID" \
  --query 'SecurityGroups[0].GroupId' --output text)
if [[ -z "$SG_ID" ]]; then
  SG_ID=$(aws ec2 create-security-group --group-name "$SG_NAME" \
    --description "SSH to EC2 manager hub" --vpc-id "$VPC_ID" \
    --query GroupId --output text)
  info "Created security group $SG_ID"
else
  info "Reusing security group $SG_ID"
fi
SSH_CIDR="${SSH_CIDR:-${MY_IP}/32}"
APP_CIDR="${APP_CIDR:-${MY_IP}/32}"

open_port() {
  local port="$1" cidr="$2"
  if aws ec2 authorize-security-group-ingress --group-id "$SG_ID" \
      --protocol tcp --port "$port" --cidr "$cidr" >/dev/null 2>&1; then
    info "Allowed TCP $port from $cidr"
  else
    info "TCP $port from $cidr already allowed"
  fi
}

open_port "$SSH_PORT" "$SSH_CIDR"
for port in "${APP_PORTS[@]}"; do
  open_port "$port" "$APP_CIDR"
done

# ------------------------------ 2. Key pair ------------------------------
log "Step 2/6: Key pair"
if aws ec2 describe-key-pairs --key-names "$KEY_NAME" >/dev/null 2>&1; then
  if [[ -f "$KEY_FILE" ]]; then
    info "Key pair $KEY_NAME exists and $KEY_FILE is present"
  else
    warn "Key pair $KEY_NAME exists in AWS but $KEY_FILE is missing locally."
    warn "AWS cannot re-download it. Run teardown, or delete the key pair and re-run:"
    warn "  aws ec2 delete-key-pair --key-name $KEY_NAME"
    die "Missing private key file."
  fi
else
  aws ec2 create-key-pair --key-name "$KEY_NAME" \
    --query KeyMaterial --output text > "$KEY_FILE"
  chmod 400 "$KEY_FILE"
  info "Created key pair, saved private key to $KEY_FILE"
fi

# ------------------------------ 3. IAM roles -----------------------------
log "Step 3/6: IAM roles and instance profile"

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

# Hub role
cat > "$TMP_DIR/hub-trust.json" <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Service": "ec2.amazonaws.com" },
    "Action": "sts:AssumeRole"
  }]
}
EOF

PROFILE_IS_NEW=false
if aws iam get-role --role-name "$HUB_ROLE" >/dev/null 2>&1; then
  info "Reusing role $HUB_ROLE"
else
  aws iam create-role --role-name "$HUB_ROLE" \
    --assume-role-policy-document "file://$TMP_DIR/hub-trust.json" \
    --description "Hub role for EC2 Instance Manager - can only assume execution roles" >/dev/null
  info "Created role $HUB_ROLE"
  PROFILE_IS_NEW=true
fi
HUB_ROLE_ARN=$(aws iam get-role --role-name "$HUB_ROLE" --query Role.Arn --output text)

# Hub role may assume Execution roles in any account (name must match exactly)
cat > "$TMP_DIR/hub-permissions.json" <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": "sts:AssumeRole",
    "Resource": "arn:aws:iam::*:role/Ec2ManagerExecutionRole"
  }]
}
EOF
aws iam put-role-policy --role-name "$HUB_ROLE" \
  --policy-name AssumeExecutionRoles \
  --policy-document "file://$TMP_DIR/hub-permissions.json"
info "Applied AssumeExecutionRoles policy to $HUB_ROLE"

# Execution role (trusts the Hub role)
cat > "$TMP_DIR/exec-trust.json" <<EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "AWS": "$HUB_ROLE_ARN" },
    "Action": "sts:AssumeRole"
  }]
}
EOF

if aws iam get-role --role-name "$EXEC_ROLE" >/dev/null 2>&1; then
  aws iam update-assume-role-policy --role-name "$EXEC_ROLE" \
    --policy-document "file://$TMP_DIR/exec-trust.json"
  info "Reusing role $EXEC_ROLE (trust policy refreshed)"
else
  aws iam create-role --role-name "$EXEC_ROLE" \
    --assume-role-policy-document "file://$TMP_DIR/exec-trust.json" \
    --description "Execution role for EC2 Instance Manager - describe/start/stop" >/dev/null
  info "Created role $EXEC_ROLE"
  PROFILE_IS_NEW=true
fi

cat > "$TMP_DIR/exec-permissions.json" <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DescribeAndDiscover",
      "Effect": "Allow",
      "Action": ["ec2:DescribeInstances", "ec2:DescribeRegions", "ec2:DescribeTags"],
      "Resource": "*"
    },
    {
      "Sid": "StartStopInstances",
      "Effect": "Allow",
      "Action": ["ec2:StartInstances", "ec2:StopInstances"],
      "Resource": "*"
    }
  ]
}
EOF
aws iam put-role-policy --role-name "$EXEC_ROLE" \
  --policy-name Ec2ManagerExecutionPermissions \
  --policy-document "file://$TMP_DIR/exec-permissions.json"
EXEC_ROLE_ARN=$(aws iam get-role --role-name "$EXEC_ROLE" --query Role.Arn --output text)
info "Applied Ec2ManagerExecutionPermissions to $EXEC_ROLE"

# Instance profile
if aws iam get-instance-profile --instance-profile-name "$PROFILE_NAME" >/dev/null 2>&1; then
  info "Reusing instance profile $PROFILE_NAME"
else
  aws iam create-instance-profile --instance-profile-name "$PROFILE_NAME" >/dev/null
  info "Created instance profile $PROFILE_NAME"
  PROFILE_IS_NEW=true
fi
ATTACHED=$(lookup aws iam get-instance-profile --instance-profile-name "$PROFILE_NAME" \
  --query 'InstanceProfile.Roles[0].RoleName' --output text)
if [[ "$ATTACHED" != "$HUB_ROLE" ]]; then
  aws iam add-role-to-instance-profile \
    --instance-profile-name "$PROFILE_NAME" --role-name "$HUB_ROLE"
  info "Added $HUB_ROLE to $PROFILE_NAME"
  PROFILE_IS_NEW=true
fi

if [[ "$PROFILE_IS_NEW" == "true" ]]; then
  info "Waiting 15s for IAM to propagate..."
  sleep 15
fi

# ------------------------------ 4. AMI -----------------------------------
log "Step 4/6: Looking up latest Ubuntu 22.04 AMI"
AMI_ID=$(aws ssm get-parameter --name "$UBUNTU_AMI_PARAM" \
  --query Parameter.Value --output text)
info "AMI: $AMI_ID"

# Launch helper with retry (new instance profiles can take a moment to be usable)
launch_instance() {
  local name="$1" profile_args="$2" extra_tags="${3:-}"
  local out attempt
  for attempt in 1 2 3 4 5 6; do
    if out=$(aws ec2 run-instances \
        --image-id "$AMI_ID" --instance-type "$INSTANCE_TYPE" \
        --key-name "$KEY_NAME" \
        --block-device-mappings "DeviceName=$ROOT_DEVICE_NAME,Ebs={VolumeSize=$ROOT_VOLUME_GB,VolumeType=gp3,DeleteOnTermination=true}" \
        --security-group-ids "$SG_ID" --subnet-id "$SUBNET_ID" \
        $profile_args \
        --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$name}${extra_tags}]" \
        --query 'Instances[0].InstanceId' --output text 2>&1); then
      printf '%s' "$out"
      return 0
    fi
    if [[ "$out" == *"Invalid IAM Instance Profile"* || "$out" == *"iamInstanceProfile"* ]]; then
      printf '    Instance profile not ready yet (attempt %s/6), retrying in 10s...\n' "$attempt" >&2
      sleep 10
    else
      printf '%s\n' "$out" >&2
      return 1
    fi
  done
  return 1
}

# ------------------------------ 5. Hub instance --------------------------
log "Step 5/6: Hub instance"
HUB_INSTANCE_ID=$(lookup aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=$HUB_NAME" \
            "Name=instance-state-name,Values=pending,running,stopping,stopped" \
  --query 'Reservations[0].Instances[0].InstanceId' --output text)

if [[ -z "$HUB_INSTANCE_ID" ]]; then
  HUB_INSTANCE_ID=$(launch_instance "$HUB_NAME" "--iam-instance-profile Name=$PROFILE_NAME") \
    || die "Failed to launch hub instance. If AWS reports the instance type is not eligible for this account, retry with another type, e.g. INSTANCE_TYPE=t3.medium."
  info "Launched hub instance $HUB_INSTANCE_ID"
else
  info "Reusing hub instance $HUB_INSTANCE_ID"
  STATE=$(aws ec2 describe-instances --instance-ids "$HUB_INSTANCE_ID" \
    --query 'Reservations[0].Instances[0].State.Name' --output text)
  if [[ "$STATE" == "stopped" ]]; then
    aws ec2 start-instances --instance-ids "$HUB_INSTANCE_ID" >/dev/null
    info "Starting stopped instance"
  fi
fi
aws ec2 wait instance-running --instance-ids "$HUB_INSTANCE_ID"
HUB_IP=$(aws ec2 describe-instances --instance-ids "$HUB_INSTANCE_ID" \
  --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)
info "Hub running at $HUB_IP"

# ------------------------------ 6. Test target ---------------------------
TARGET_ID=""
log "Step 6/6: Test target instance (CREATE_TARGET=$CREATE_TARGET)"
if [[ "$CREATE_TARGET" == "true" ]]; then
  TARGET_ID=$(lookup aws ec2 describe-instances \
    --filters "Name=tag:Name,Values=$TARGET_NAME" \
              "Name=instance-state-name,Values=pending,running,stopping,stopped" \
    --query 'Reservations[0].Instances[0].InstanceId' --output text)
  if [[ -z "$TARGET_ID" ]]; then
    TARGET_ID=$(launch_instance "$TARGET_NAME" "" ",{Key=DNS,Value=$TARGET_DNS_TAG}") \
      || die "Failed to launch test target."
    info "Launched test target $TARGET_ID (tag DNS=$TARGET_DNS_TAG)"
  else
    info "Reusing test target $TARGET_ID"
  fi
else
  info "Skipped (set CREATE_TARGET=true to launch one)"
fi

# ------------------------------ Save state -------------------------------
cat > "$ENV_FILE" <<EOF
# Generated by setup-ec2-manager.sh - source this file to restore variables:
#   source $ENV_FILE
export AWS_REGION="$REGION"
export AWS_DEFAULT_REGION="$REGION"
export ACCOUNT_ID="$ACCOUNT_ID"
export VPC_ID="$VPC_ID"
export SUBNET_ID="$SUBNET_ID"
export IGW_ID="$IGW_ID"
export RT_ID="$RT_ID"
export SG_ID="$SG_ID"
export MY_IP="$MY_IP"
export AMI_ID="$AMI_ID"
export HUB_ROLE_ARN="$HUB_ROLE_ARN"
export EXEC_ROLE_ARN="$EXEC_ROLE_ARN"
export HUB_INSTANCE_ID="$HUB_INSTANCE_ID"
export HUB_IP="$HUB_IP"
export TARGET_ID="$TARGET_ID"
EOF

log "Setup complete"
cat <<EOF

  Account          : $ACCOUNT_ID
  Region           : $REGION
  VPC / Subnet     : $VPC_ID / $SUBNET_ID
  Instance config  : $INSTANCE_TYPE, ${ROOT_VOLUME_GB} GB gp3 root volume
  Security group   : $SG_ID
    SSH ($SSH_PORT)      from $SSH_CIDR
    App ports (${APP_PORTS[*]}) from $APP_CIDR
  Hub role         : $HUB_ROLE_ARN
  Execution role   : $EXEC_ROLE_ARN   <-- use as roleArn in app config
  Hub instance     : $HUB_INSTANCE_ID  ($HUB_IP)
  Test target      : ${TARGET_ID:-none}

  Variables saved to $ENV_FILE  (run: source $ENV_FILE)

  Verify the role chain from the hub:

    ssh -i $KEY_FILE ubuntu@$HUB_IP
    sudo apt-get update && sudo apt-get install -y python3-boto3
    python3 -c "
    import boto3
    sts = boto3.client('sts')
    print(sts.get_caller_identity()['Arn'])
    r = sts.assume_role(RoleArn='$EXEC_ROLE_ARN', RoleSessionName='test')
    print('Assumed OK, expires', r['Credentials']['Expiration'])
    "

  Note: if your public IP changes, re-run this script to add the new SSH rule.
EOF

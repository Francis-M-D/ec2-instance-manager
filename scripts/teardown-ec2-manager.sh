#!/usr/bin/env bash
#
# teardown-ec2-manager.sh
# Removes everything created by setup-ec2-manager.sh:
#   EC2 instances (hub + test target), key pair (+ local .pem), instance profile,
#   Hub and Execution IAM roles, security group, route table, subnet,
#   internet gateway, VPC.
#
# Only resources matching the setup script's names are touched.
#
# Usage:
#   ./teardown-ec2-manager.sh          # asks for confirmation
#   ./teardown-ec2-manager.sh --yes    # no prompt
#
set -uo pipefail

REGION="${AWS_REGION:-ap-south-1}"

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

export AWS_DEFAULT_REGION="$REGION"
export AWS_PAGER=""

AUTO_YES=false
[[ "${1:-}" == "--yes" || "${1:-}" == "-y" ]] && AUTO_YES=true

log()  { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
info() { printf '    %s\n' "$*"; }
warn() { printf '\033[1;33m    ! %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

lookup() {
  local v
  v=$("$@" 2>/dev/null || true)
  if [[ "$v" == "None" ]]; then v=""; fi
  printf '%s' "$v"
}

command -v aws >/dev/null 2>&1 || die "AWS CLI not found."
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text 2>/dev/null) \
  || die "Cannot call AWS. Check your credentials."

cat <<EOF

This will PERMANENTLY DELETE the EC2 Instance Manager setup in:
  Account : $ACCOUNT_ID
  Region  : $REGION

  - EC2 instances tagged Name=$HUB_NAME and Name=$TARGET_NAME (terminated)
  - Key pair $KEY_NAME and local file $KEY_FILE
  - IAM roles $HUB_ROLE and $EXEC_ROLE, instance profile $PROFILE_NAME
  - VPC $VPC_NAME with its subnet, internet gateway, route table, security group

EOF
if [[ "$AUTO_YES" != "true" ]]; then
  read -r -p "Type 'delete' to continue: " CONFIRM
  [[ "$CONFIRM" == "delete" ]] || { echo "Aborted."; exit 1; }
fi

# ------------------------------ 1. Instances -----------------------------
log "Step 1/5: Terminating instances"
INSTANCE_IDS=$(aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=$HUB_NAME,$TARGET_NAME" \
            "Name=instance-state-name,Values=pending,running,stopping,stopped" \
  --query 'Reservations[].Instances[].InstanceId' --output text 2>/dev/null || true)

if [[ -n "$INSTANCE_IDS" && "$INSTANCE_IDS" != "None" ]]; then
  info "Terminating: $INSTANCE_IDS"
  # shellcheck disable=SC2086
  aws ec2 terminate-instances --instance-ids $INSTANCE_IDS >/dev/null
  info "Waiting for termination (can take a minute or two)..."
  # shellcheck disable=SC2086
  aws ec2 wait instance-terminated --instance-ids $INSTANCE_IDS
  info "Instances terminated"
else
  info "No instances found"
fi

# ------------------------------ 2. Key pair ------------------------------
log "Step 2/5: Key pair"
if aws ec2 describe-key-pairs --key-names "$KEY_NAME" >/dev/null 2>&1; then
  aws ec2 delete-key-pair --key-name "$KEY_NAME" && info "Deleted key pair $KEY_NAME"
else
  info "Key pair not found"
fi
if [[ -f "$KEY_FILE" ]]; then
  rm -f "$KEY_FILE" && info "Removed local $KEY_FILE"
fi

# ------------------------------ 3. IAM -----------------------------------
log "Step 3/5: IAM roles and instance profile"

if aws iam get-instance-profile --instance-profile-name "$PROFILE_NAME" >/dev/null 2>&1; then
  for r in $(aws iam get-instance-profile --instance-profile-name "$PROFILE_NAME" \
              --query 'InstanceProfile.Roles[].RoleName' --output text); do
    aws iam remove-role-from-instance-profile \
      --instance-profile-name "$PROFILE_NAME" --role-name "$r" \
      && info "Removed $r from $PROFILE_NAME"
  done
  aws iam delete-instance-profile --instance-profile-name "$PROFILE_NAME" \
    && info "Deleted instance profile $PROFILE_NAME"
else
  info "Instance profile not found"
fi

delete_role() {
  local role="$1" p
  if ! aws iam get-role --role-name "$role" >/dev/null 2>&1; then
    info "Role $role not found"
    return 0
  fi
  for p in $(aws iam list-role-policies --role-name "$role" \
              --query 'PolicyNames[]' --output text); do
    aws iam delete-role-policy --role-name "$role" --policy-name "$p" \
      && info "Deleted inline policy $p from $role"
  done
  for p in $(aws iam list-attached-role-policies --role-name "$role" \
              --query 'AttachedPolicies[].PolicyArn' --output text); do
    aws iam detach-role-policy --role-name "$role" --policy-arn "$p" \
      && info "Detached $p from $role"
  done
  aws iam delete-role --role-name "$role" && info "Deleted role $role"
}
delete_role "$EXEC_ROLE"
delete_role "$HUB_ROLE"

# ------------------------------ 4. Network -------------------------------
log "Step 4/5: Networking"

VPC_ID=$(lookup aws ec2 describe-vpcs \
  --filters "Name=tag:Name,Values=$VPC_NAME" \
  --query 'Vpcs[0].VpcId' --output text)

if [[ -z "$VPC_ID" ]]; then
  info "VPC $VPC_NAME not found, nothing to delete"
else
  info "VPC: $VPC_ID"

  # Security group (retry: it can stay 'in use' briefly after instance termination)
  SG_ID=$(lookup aws ec2 describe-security-groups \
    --filters "Name=group-name,Values=$SG_NAME" "Name=vpc-id,Values=$VPC_ID" \
    --query 'SecurityGroups[0].GroupId' --output text)
  if [[ -n "$SG_ID" ]]; then
    for attempt in 1 2 3 4 5 6; do
      if aws ec2 delete-security-group --group-id "$SG_ID" 2>/dev/null; then
        info "Deleted security group $SG_ID"
        break
      fi
      info "Security group still in use (attempt $attempt/6), retrying in 10s..."
      sleep 10
    done
  fi

  # Route table (disassociate first, then delete)
  RT_ID=$(lookup aws ec2 describe-route-tables \
    --filters "Name=tag:Name,Values=$RT_NAME" "Name=vpc-id,Values=$VPC_ID" \
    --query 'RouteTables[0].RouteTableId' --output text)
  if [[ -n "$RT_ID" ]]; then
    for assoc in $(aws ec2 describe-route-tables --route-table-ids "$RT_ID" \
                    --query 'RouteTables[0].Associations[?Main==`false`].RouteTableAssociationId' \
                    --output text 2>/dev/null); do
      aws ec2 disassociate-route-table --association-id "$assoc" \
        && info "Disassociated $assoc"
    done
    aws ec2 delete-route-table --route-table-id "$RT_ID" \
      && info "Deleted route table $RT_ID"
  fi

  # Subnet
  SUBNET_ID=$(lookup aws ec2 describe-subnets \
    --filters "Name=tag:Name,Values=$SUBNET_NAME" "Name=vpc-id,Values=$VPC_ID" \
    --query 'Subnets[0].SubnetId' --output text)
  if [[ -n "$SUBNET_ID" ]]; then
    aws ec2 delete-subnet --subnet-id "$SUBNET_ID" && info "Deleted subnet $SUBNET_ID"
  fi

  # Internet gateway (detach, then delete)
  IGW_ID=$(lookup aws ec2 describe-internet-gateways \
    --filters "Name=tag:Name,Values=$IGW_NAME" \
    --query 'InternetGateways[0].InternetGatewayId' --output text)
  if [[ -n "$IGW_ID" ]]; then
    aws ec2 detach-internet-gateway --internet-gateway-id "$IGW_ID" --vpc-id "$VPC_ID" \
      && info "Detached $IGW_ID"
    aws ec2 delete-internet-gateway --internet-gateway-id "$IGW_ID" \
      && info "Deleted internet gateway $IGW_ID"
  fi

  # VPC
  if aws ec2 delete-vpc --vpc-id "$VPC_ID"; then
    info "Deleted VPC $VPC_ID"
  else
    warn "Could not delete VPC $VPC_ID. Something else is still inside it (e.g. another instance or network interface)."
    warn "Inspect with: aws ec2 describe-network-interfaces --filters Name=vpc-id,Values=$VPC_ID"
  fi
fi

# ------------------------------ 5. Local files ---------------------------
log "Step 5/5: Local files"
if [[ -f "$ENV_FILE" ]]; then
  rm -f "$ENV_FILE" && info "Removed $ENV_FILE"
else
  info "No env file to remove"
fi

log "Teardown complete"
echo
echo "  Also clear any variables left in your current shell:"
echo "    unset VPC_ID SUBNET_ID IGW_ID RT_ID SG_ID MY_IP AMI_ID HUB_ROLE_ARN EXEC_ROLE_ARN HUB_INSTANCE_ID HUB_IP TARGET_ID"
echo

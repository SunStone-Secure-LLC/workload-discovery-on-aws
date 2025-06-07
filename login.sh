#!/bin/bash
#set -eo pipefail

# CONFIGURATION
# AWS_SSO_URL, AWS_REGION, TARGET_AWS_ACCOUNT_ID, and TARGET_PERMISSION_SET_NAME can be set as environment variables,
# passed as script arguments, or will be prompted if not found.

export AWS_SSO_URL=${AWS_SSO_URL:-https://d-9066332223.awsapps.com/start}
export AWS_REGION=${AWS_REGION:-us-east-1}
TARGET_AWS_ACCOUNT_ID=${TARGET_AWS_ACCOUNT_ID:-$1}
TARGET_PERMISSION_SET_NAME=${TARGET_PERMISSION_SET_NAME:-$2} # Use env var, then 2nd arg, then prompt

echo "Starting AWS SSO login...IMPORTANT: BE SURE YOU ARE LOGGED IN AS THE RIGHT IDC USER -- NOT ROOT -- IN OTHER AWS CONSOLE SESSIONS!!!"

# If AWS_SSO_URL is not set or is empty, prompt for it
if [ -z "$AWS_SSO_URL" ]; then
    read -p "Enter AWS SSO URL: " AWS_SSO_URL
    if [[ ! $AWS_SSO_URL =~ ^https://.*awsapps.com.*$ ]]; then
        echo "Invalid AWS SSO URL, exiting. To try again, run 'awslogin'"
        exit 1
    fi
fi
export AWS_SSO_URL # Ensure it's exported if read

# If AWS_REGION is not set or is empty, prompt for it
if [ -z "$AWS_REGION" ]; then
    read -p "Enter AWS Region: " AWS_REGION
    if [[ ! $AWS_REGION =~ ^[a-z]{2}-[a-z]{4,9}-[0-9]$ ]]; then
        echo "Invalid AWS Region, exiting. To try again, run 'awslogin'"
        exit 1
    fi
fi
export AWS_REGION # Ensure it's exported if read

# If TARGET_AWS_ACCOUNT_ID is not set (either by env var or script arg $1), prompt for it
if [ -z "$TARGET_AWS_ACCOUNT_ID" ]; then
    read -p "Enter Target AWS Account ID: " TARGET_AWS_ACCOUNT_ID
fi

# Validate TARGET_AWS_ACCOUNT_ID
if [[ ! $TARGET_AWS_ACCOUNT_ID =~ ^[0-9]{12}$ ]]; then
    echo "Invalid Target AWS Account ID (must be 12 digits), exiting. You entered: '$TARGET_AWS_ACCOUNT_ID'"
    exit 1
fi

# If TARGET_PERMISSION_SET_NAME is not set (either by env var or script arg $2), prompt for it
if [ -z "$TARGET_PERMISSION_SET_NAME" ]; then
    read -p "Enter Target Permission Set Name (e.g., ArtemisFullAWSAdminAccess): " TARGET_PERMISSION_SET_NAME
fi

# Validate TARGET_PERMISSION_SET_NAME (basic check for non-empty)
if [ -z "$TARGET_PERMISSION_SET_NAME" ]; then
    echo "Invalid Target Permission Set Name (cannot be empty), exiting."
    exit 1
fi

# Clear out any existing AWS config
rm -rf ~/.aws

# Create profile for AWS SSO 
# IMPORTANT: the sso_role_name is NOT an IAM Role, it is the Permission Set Name in IDC!
# so sso_role_name needs to match the ps created in assign_permission.sh usually via cloudshell to bootstrap codespaces
mkdir -p ~/.aws

# here we have multiple profiles that we can switch to for different tasks

# SECURITY AUDITOR 
echo "[profile codespaces-securityaudit]" >> ~/.aws/config
echo "sso_session    = codespaces-session" >> ~/.aws/config
echo "sso_account_id = $TARGET_AWS_ACCOUNT_ID" >> ~/.aws/config
echo "sso_role_name = SecurityAuditPermissionSet" >> ~/.aws/config
echo "region = $AWS_REGION" >> ~/.aws/config
echo " " >> ~/.aws/config

# FULL ADMIN
echo "[profile codespaces-fulladmin]" >> ~/.aws/config
echo "sso_session    = codespaces-session" >> ~/.aws/config
echo "sso_account_id = $TARGET_AWS_ACCOUNT_ID" >> ~/.aws/config
echo "sso_role_name = $TARGET_PERMISSION_SET_NAME" >> ~/.aws/config
echo "region = $AWS_REGION" >> ~/.aws/config
echo " " >> ~/.aws/config

# the SSO session
echo "[sso-session codespaces-session]" >> ~/.aws/config
echo "sso_start_url = $AWS_SSO_URL" >> ~/.aws/config
echo "sso_region    = $AWS_REGION" >> ~/.aws/config
echo "sso_registration_scopes = sso:account:access" >> ~/.aws/config

aws sso login --sso-session codespaces-session --profile "codespaces-fulladmin"  --use-device-code
export AWS_PROFILE=codespaces-fulladmin

sso_session=$(aws configure get sso_session --profile "${AWS_PROFILE}")
# Check if sso_session is empty, which can happen if the profile or session doesn't exist or isn't configured yet
if [ -z "$sso_session" ]; then
    echo "Error: Could not retrieve sso_session for profile '${AWS_PROFILE}'."
    echo "This might happen if the SSO login failed or the profile is not correctly configured in ~/.aws/config yet."
    exit 1
fi
cache_file_hash_input="${sso_session}"
# Handle potential differences in sha1sum output (coreutils vs other implementations)
if command -v sha1sum >/dev/null && echo -n "test" | sha1sum - | grep -q -- '-'; then
    # GNU coreutils sha1sum (prints ' -')
    cache_file_sha1=$(echo -n "${cache_file_hash_input}" | sha1sum | awk '{print $1}')
else
    # Other sha1sum (e.g., on macOS, prints just the hash)
    cache_file_sha1=$(echo -n "${cache_file_hash_input}" | sha1sum)
fi
cache_file="${HOME}/.aws/sso/cache/${cache_file_sha1}.json"

if [ ! -f "$cache_file" ]; then
    echo "Error: SSO cache file not found at $cache_file"
    echo "This usually means the 'aws sso login' command did not complete successfully or the session name is incorrect."
    exit 1
fi
access_token=$(jq --raw-output .accessToken "${cache_file}")

if [ -z "$access_token" ] || [ "$access_token" == "null" ]; then
    echo "Error: Failed to extract accessToken from SSO cache file: $cache_file"
    echo "The file might be corrupted, or the SSO login was not fully successful in populating it."
    echo "Cache file content:"
    cat "$cache_file"
    exit 1
fi

# After SSO login, optionally get temporary credentials
SELECTED_ACCOUNT_ID="$TARGET_AWS_ACCOUNT_ID"
SELECTED_ROLE_NAME="$TARGET_PERMISSION_SET_NAME"
echo "Attempting to retrieve credentials for role: $SELECTED_ROLE_NAME in account: $SELECTED_ACCOUNT_ID"

# Get temporary credentials using aws sso get-role-credentials
# The user must have logged in via SSO for the 'codespaces-session' for this to work
    
AWS_STDERR_FILE=$(mktemp) # Create a temporary file to capture stderr

# Execute the command, capturing stdout to CREDENTIALS_JSON and stderr to AWS_STDERR_FILE
CREDENTIALS_JSON=$(aws sso get-role-credentials --role-name "$SELECTED_ROLE_NAME" --account-id "$SELECTED_ACCOUNT_ID" --access-token "$access_token" --region "$AWS_REGION" --output json 2> "$AWS_STDERR_FILE")
AWS_CLI_EXIT_CODE=$? # Capture the exit code of the aws command

if [ $AWS_CLI_EXIT_CODE -ne 0 ]; then
    echo "Error: 'aws sso get-role-credentials' command failed with exit code $AWS_CLI_EXIT_CODE."
    echo "This could be due to an expired SSO session, incorrect role/account, or network issues."
    echo "Please ensure you have run 'aws sso login --sso-session codespaces-session' successfully and have the correct permissions."
    echo ""
    echo "Detailed error from AWS CLI:"
    cat "$AWS_STDERR_FILE" # Display the captured stderr
    rm -f "$AWS_STDERR_FILE" # Clean up the temporary file
    exit 1 # Exit the script with our own error code
fi

rm -f "$AWS_STDERR_FILE" # Clean up the temporary file if command was successful

if [ -z "$CREDENTIALS_JSON" ]; then
    echo "Failed to retrieve credentials (empty JSON response from AWS CLI even though command reported success)."
    echo "This is unexpected. Please check AWS CLI version and SSO configuration."
    exit 1
fi

# Parse credentials using jq
AWS_ACCESS_KEY_ID=$(echo "$CREDENTIALS_JSON" | jq -r '.roleCredentials.accessKeyId')
AWS_SECRET_ACCESS_KEY=$(echo "$CREDENTIALS_JSON" | jq -r '.roleCredentials.secretAccessKey')
AWS_SESSION_TOKEN=$(echo "$CREDENTIALS_JSON" | jq -r '.roleCredentials.sessionToken')

# Check if jq successfully parsed the credential components
if [ -z "$AWS_ACCESS_KEY_ID" ] || [ "$AWS_ACCESS_KEY_ID" == "null" ] || \
    [ -z "$AWS_SECRET_ACCESS_KEY" ] || [ "$AWS_SECRET_ACCESS_KEY" == "null" ] || \
    [ -z "$AWS_SESSION_TOKEN" ] || [ "$AWS_SESSION_TOKEN" == "null" ]; then
    echo "Error: Failed to parse expected credential fields from the AWS SSO response."
    echo "This usually means the 'aws sso get-role-credentials' command did not return valid credential data."
    echo "Possible reasons include:"
    echo "  - Your AWS SSO session may have expired or is invalid (try 'aws sso login --sso-session codespaces-session' again)."
    echo "  - The selected role ('$SELECTED_ROLE_NAME') or account ID ('$SELECTED_ACCOUNT_ID') is incorrect or you don't have permissions for it."
    echo "Raw AWS response that caused the parsing failure:"
    echo "$CREDENTIALS_JSON"
    exit 1
fi

echo "Temporary credentials obtained. Configuring [default] profile..."

# Configure the [default] profile with these credentials
aws configure set aws_access_key_id "$AWS_ACCESS_KEY_ID" --profile default
aws configure set aws_secret_access_key "$AWS_SECRET_ACCESS_KEY" --profile default
aws configure set aws_session_token "$AWS_SESSION_TOKEN" --profile default
aws configure set region "$AWS_REGION" --profile default

WHOAMI_JSON=$(aws sts get-caller-identity --output json 2> "$AWS_STDERR_FILE")
AWS_CLI_EXIT_CODE=$? # Capture the exit code of the aws command
if [ $AWS_CLI_EXIT_CODE -ne 0 ]; then
    echo "Error: 'aws sts get-caller-identity' command failed with exit code $AWS_CLI_EXIT_CODE."
    echo "This could be due to an expired SSO session, incorrect role/account, or network issues."
    echo "Please ensure you have run 'aws sso login --sso-session codespaces-session' successfully and have the correct permissions."
    echo ""
    echo "Detailed error from AWS CLI:"
    cat "$AWS_STDERR_FILE" # Display the captured stderr
    rm -f "$AWS_STDERR_FILE" # Clean up the temporary file
    exit 1 # Exit the script with our own error code
fi

rm -f "$AWS_STDERR_FILE" # Clean up the temporary file if command was successful
# Parse credentials using jq
MYUSERID=$(echo "$WHOAMI_JSON" | jq -r '.UserId')
MYACCOUNT=$(echo "$WHOAMI_JSON" | jq -r '.Account')

echo "✅ [default] profile configured with temporary credentials."
echo "These credentials will expire. You may need to run this script again to refresh them."
echo "You can now use AWS CLI commands with the [default] profile."

echo "🤘 Rock on! You are now logged in to AWS SSO with the following details:"
echo "  - AWS Account ID: $MYACCOUNT"
echo "  - User ID: $MYUSERID"
echo "  - Region: $AWS_REGION"
echo "  - Permission Set: $TARGET_PERMISSION_SET_NAME"
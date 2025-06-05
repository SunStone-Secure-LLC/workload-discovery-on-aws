# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

"""
This AWS Lambda function acts as a CloudFormation Custom Resource to manage
Amazon Cognito User Pool Identity Providers. It supports creating, updating,
and deleting identity providers (e.g., SAML, OIDC) and handles fetching
client secrets from AWS Systems Manager Parameter Store if required.
"""

import boto3 # AWS SDK for Python, used to interact with AWS services like Cognito.
import json # Used for JSON serialization/deserialization.
from botocore.exceptions import ClientError # Used for catching AWS SDK client-side errors.
from aws_lambda_powertools import Logger # AWS Lambda Powertools for structured logging.
from aws_lambda_powertools.utilities import parameters # AWS Lambda Powertools for parameter (Secrets Manager/SSM) retrieval.
from crhelper import CfnResource # Custom resource helper for CloudFormation.
from typing import TypedDict, Optional # Used for type hinting, defining dictionary structures.


# Initializes the AWS Lambda Powertools logger for structured logging.
logger = Logger(service='IdentityProviderCustomResource')

# Initializes the CloudFormation custom resource helper.
# json_logging=False: Disables JSON formatting for logs.
# log_level='INFO': Sets the logging level to INFO.
# boto_level='CRITICAL': Sets the boto3 logging level to CRITICAL to reduce verbosity from the SDK.
helper = CfnResource(json_logging=False, log_level='INFO',
                     boto_level='CRITICAL')

# Initializes a Cognito Identity Provider client.
cognito_client = boto3.client('cognito-idp')

# Initializes the AWS Systems Manager Parameter Store provider for fetching secrets.
ssm_provider = parameters.SecretsProvider()


class IdentityProviderProperties(TypedDict):
    """
    TypedDict for the properties expected in the CloudFormation custom resource.
    These properties define the identity provider to be managed.
    """
    UserPoolId: str # The ID of the Cognito User Pool.
    ProviderName: str # The name of the identity provider.
    ProviderType: str # The type of the identity provider (e.g., 'SAML', 'OIDC').
    ProviderDetails: dict # A dictionary of provider-specific details.
    AttributeMapping: str # A JSON string representing the attribute mapping.
    IdpIdentifiers: Optional[list[str]] # Optional list of IdP identifiers.


class Event(TypedDict):
    """
    TypedDict for the AWS Lambda event structure when invoked as a CloudFormation Custom Resource.
    """
    RequestType: str # Type of request: 'Create', 'Update', or 'Delete'.
    ResponseURL: str
    StackId: str
    RequestId: str
    ResourceType: str
    LogicalResourceId: str
    ResourceProperties: IdentityProviderProperties # Custom resource properties.


@helper.create
def create(event: Event, _) -> None:
    """
    Handles CloudFormation Create events for the Identity Provider custom resource.
    It creates a new identity provider in the specified Cognito User Pool.
    If the provider type is not SAML, it fetches the client secret from SSM.
    """
    logger.info('Creating identity provider')
    props: IdentityProviderProperties = event['ResourceProperties']
    provider_name = props['ProviderName']
    provider_type = props['ProviderType']
    attribute_mappings = json.loads(props['AttributeMapping']) # Parse attribute mapping from JSON string.

    # Handle provider-specific details, especially for client secrets.
    if provider_type == 'SAML':
        provider_details = props['ProviderDetails']
    else:
        # For non-SAML providers (e.g., OIDC), fetch the client secret from SSM.
        client_secret_arn = props['ClientSecretArn']
        client_secret = ssm_provider.get(client_secret_arn)
        # Merge the fetched client secret into provider details.
        provider_details = props['ProviderDetails'] | {'client_secret': client_secret}

    # Call Cognito API to create the identity provider.
    resp = cognito_client.create_identity_provider(
        UserPoolId=props['UserPoolId'],
        ProviderName=provider_name,
        ProviderType=provider_type,
        ProviderDetails=provider_details,
        AttributeMapping=attribute_mappings,
        IdpIdentifiers=props['IdpIdentifiers']
    )

    logger.info('Identity provider created')
    logger.info(resp['IdentityProvider']) # Log the created identity provider details.

    # Update helper data with the provider name, which can be used for subsequent updates/deletes.
    helper.Data.update({'ProviderName': provider_name})


@helper.update
def update(event: Event, _) -> None:
    """
    Handles CloudFormation Update events for the Identity Provider custom resource.
    It updates an existing identity provider in the specified Cognito User Pool.
    Similar to create, it handles fetching client secrets if needed.
    """
    logger.info('Updating identity provider')
    props: IdentityProviderProperties = event['ResourceProperties']
    provider_name = props['ProviderName']
    provider_type = props['ProviderType']
    attribute_mappings = json.loads(props['AttributeMapping']) # Parse attribute mapping from JSON string.

    # Handle provider-specific details, especially for client secrets.
    if provider_type == 'SAML':
        provider_details = props['ProviderDetails']
    else:
        # For non-SAML providers (e.g., OIDC), fetch the client secret from SSM.
        client_secret_arn = props['ClientSecretArn']
        client_secret = ssm_provider.get(client_secret_arn)
        # Merge the fetched client secret into provider details.
        provider_details = props['ProviderDetails'] | {'client_secret': client_secret}

    # Call Cognito API to update the identity provider.
    resp = cognito_client.update_identity_provider(
        UserPoolId=props['UserPoolId'],
        ProviderName=provider_name,
        ProviderDetails=provider_details,
        AttributeMapping=attribute_mappings,
        IdpIdentifiers=props['IdpIdentifiers']
    )

    logger.info('Identity provider updated.')
    logger.info(resp['IdentityProvider']) # Log the updated identity provider details.

    # Update helper data with the provider name.
    helper.Data.update({'ProviderName': provider_name})


@helper.delete
def delete(event: Event, _) -> None:
    """
    Handles CloudFormation Delete events for the Identity Provider custom resource.
    It deletes the specified identity provider from the Cognito User Pool.
    It gracefully handles `ResourceNotFoundException` if the provider is already deleted.
    """
    logger.info('Deleting identity provider')
    props: IdentityProviderProperties = event['ResourceProperties']
    user_pool_id = props['UserPoolId']

    try:
        # Call Cognito API to delete the identity provider.
        cognito_client.delete_identity_provider(
            UserPoolId=user_pool_id,
            ProviderName=props['ProviderName']
        )

        logger.info('Identity provider deleted.')
    except ClientError as e:
        # If the resource is already not found, log it as info and suppress the error.
        if e.response['Error']['Code'] == 'ResourceNotFoundException':
            logger.info(f'{user_pool_id} has already been deleted')
        else:
            raise e # Re-raise other client errors.


@logger.inject_lambda_context # Decorator to inject Lambda context into the logger.
def handler(event, _) -> None:
    """
    The main Lambda handler function.
    It dispatches the event to the appropriate helper function (create, update, or delete)
    based on the CloudFormation request type.
    """
    helper(event, _)

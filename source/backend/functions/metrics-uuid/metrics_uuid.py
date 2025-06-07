# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

"""
This AWS Lambda function acts as a CloudFormation Custom Resource to create and manage
a unique UUID (Universally Unique Identifier) for anonymous metrics collection.
It stores this UUID in AWS Systems Manager Parameter Store, ensuring that a consistent
identifier is used for reporting anonymous usage data.
"""

import boto3 # AWS SDK for Python, used to interact with AWS services like SSM.
from uuid import uuid4 # Used for generating UUIDs.
from aws_lambda_powertools import Logger # AWS Lambda Powertools for structured logging.
from crhelper import CfnResource # Custom resource helper for CloudFormation.
from typing import TypedDict, Dict # Used for type hinting, defining dictionary structures.


# Initializes the AWS Lambda Powertools logger for structured logging.
logger = Logger(service='MetricsUuidCustomResource')

# Initializes the CloudFormation custom resource helper.
# json_logging=False: Disables JSON formatting for logs.
# log_level='INFO': Sets the logging level to INFO.
# boto_level='CRITICAL': Sets the boto3 logging level to CRITICAL to reduce verbosity from the SDK.
helper = CfnResource(json_logging=False, log_level='INFO',
                     boto_level='CRITICAL')

# Initializes an SSM client, which provides a low-level interface to SSM API calls.
ssm_client = boto3.client('ssm')

# Defines the name of the SSM Parameter where the metrics UUID will be stored.
metrics_parameter_name = '/Solutions/WorkloadDiscovery/anonymous_metrics_uuid'


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
    ResourceProperties: Dict # Custom resource properties (can be any dictionary).


@helper.create
@helper.update
def create(event: Event, _) -> None:
    """
    Handles CloudFormation Create and Update events for the Metrics UUID custom resource.
    It attempts to retrieve an existing UUID from SSM Parameter Store. If not found,
    it generates a new UUID and stores it. The UUID is then added to the helper's Data.
    """
    logger.info('Creating metrics uuid')

    try:
        # Attempt to get the existing UUID from SSM Parameter Store.
        get_resp = ssm_client.get_parameter(Name=metrics_parameter_name)
        logger.info('Metrics uuid already exists')
        # If found, update helper data with the existing UUID.
        helper.Data.update({'MetricsUuid': get_resp['Parameter']['Value']})
    except ssm_client.exceptions.ParameterNotFound:
        # If the parameter is not found, generate a new UUID.
        uuid = str(uuid4())
        # Store the new UUID in SSM Parameter Store.
        ssm_client.put_parameter(
            Name=metrics_parameter_name,
            Description='Unique Id for anonymous metrics collection',
            Value=uuid,
            Type='String' # Store as a String type parameter.
        )
        logger.info(f'Metrics uuid created: {uuid}')
        # Update helper data with the newly created UUID.
        helper.Data.update({'MetricsUuid': uuid})


def handler(event, _) -> None:
    """
    The main Lambda handler function.
    It dispatches the event to the appropriate helper function (create, update, or delete)
    based on the CloudFormation request type.
    Note: The delete operation for this custom resource is implicitly handled by CloudFormation
    deleting the SSM parameter, so no explicit `helper.delete` function is needed here.
    """
    helper(event, _)

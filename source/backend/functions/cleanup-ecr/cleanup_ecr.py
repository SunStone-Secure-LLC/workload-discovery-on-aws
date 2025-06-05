# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

"""
This AWS Lambda function is designed to clean up an Amazon ECR (Elastic Container Registry) repository.
It is typically used as a custom resource in CloudFormation to ensure that
all images within a specified ECR repository are deleted when a CloudFormation stack is deleted.
"""

import boto3 # AWS SDK for Python, used to interact with AWS services like ECR.
from crhelper import CfnResource # Custom resource helper for CloudFormation.
from boto_utils import paginate # Utility for paginating AWS SDK responses.
from lambda_layers.decorators import with_logging # Custom decorator for logging Lambda events.


# Initializes the CloudFormation custom resource helper.
# json_logging=False: Disables JSON formatting for logs.
# log_level='DEBUG': Sets the logging level to DEBUG for detailed output.
# boto_level='CRITICAL': Sets the boto3 logging level to CRITICAL to reduce verbosity from the SDK.
helper = CfnResource(json_logging=False, log_level='DEBUG',
                     boto_level='CRITICAL')

# Initializes an ECR client, which provides a low-level interface to ECR API calls.
ecr_client = boto3.client("ecr")


@with_logging # Applies the custom logging decorator.
@helper.create # Decorator to register this function as the handler for CloudFormation Create events.
@helper.update # Decorator to register this function as the handler for CloudFormation Update events.
def create(event, context):
    """
    Handles CloudFormation Create and Update events.
    For ECR cleanup, no specific action is needed on creation or update,
    as the cleanup logic is primarily for deletion.
    """
    return None


@with_logging # Applies the custom logging decorator.
@helper.delete # Decorator to register this function as the handler for CloudFormation Delete events.
def delete(event, context):
    """
    Handles CloudFormation Delete events.
    This function is responsible for deleting all images within the specified ECR repository.
    """
    props = event['ResourceProperties']
    repository = props["Repository"] # Get the ECR repository name from resource properties.

    # Paginate through all images in the repository.
    images = list(paginate(ecr_client, ecr_client.list_images, ["imageIds"], repositoryName=repository))

    # If there are images, batch delete them.
    if images:
        ecr_client.batch_delete_image(
            imageIds=images, repositoryName=repository)

    return None


def handler(event, context):
    """
    The main Lambda handler function.
    It dispatches the event to the appropriate helper function (create, update, or delete)
    based on the CloudFormation request type.
    """
    helper(event, context)

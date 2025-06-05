# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

"""
This AWS Lambda function acts as a CloudFormation Custom Resource to trigger
an AWS CodeBuild project. It is typically used during CloudFormation stack
creation or updates to initiate a build process, for example, to deploy
frontend assets or perform other build-related tasks.
"""

import boto3 # AWS SDK for Python, used to interact with AWS services like CodeBuild.
import logging # Standard Python logging library.

from os import getenv # Used to retrieve environment variables.
from crhelper import CfnResource # Custom resource helper for CloudFormation.


# Initializes the CloudFormation custom resource helper.
# json_logging=False: Disables JSON formatting for logs.
# log_level='DEBUG': Sets the logging level to DEBUG for detailed output.
# boto_level='CRITICAL': Sets the boto3 logging level to CRITICAL to reduce verbosity from the SDK.
helper = CfnResource(json_logging=False, log_level="DEBUG", boto_level="CRITICAL")
# Configures the logger for the Lambda function.
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

try:
    # Retrieve the CodeBuild project name from environment variables.
    CODEBUILD_PROJECT_NAME = getenv("CODEBUILD_PROJECT_NAME")
    # Initialize a CodeBuild client.
    codebuild = boto3.client("codebuild")
except Exception as e:
    # If any error occurs during initialization (e.g., missing environment variable),
    # signal a CloudFormation custom resource failure.
    helper.init_failure(e)

@helper.create
@helper.update
def create_update(event, context):
    """
    Handles CloudFormation Create and Update events for the CodeBuild custom resource.
    It starts a new build for the specified CodeBuild project.
    @param event: The CloudFormation custom resource event.
    @param context: The Lambda context object.
    @return: The ARN of the started CodeBuild build, or None if not available.
    """
    logger.info(f"Starting CodeBuild project: {CODEBUILD_PROJECT_NAME}")
    res = codebuild.start_build(
        projectName=CODEBUILD_PROJECT_NAME,
    )
    # Return the ARN of the started build.
    return res.get("build", {}).get("arn")

def handler(event, context):
    """
    The main Lambda handler function.
    It dispatches the event to the appropriate helper function (create_update or delete)
    based on the CloudFormation request type.
    Note: This custom resource does not define a specific `delete` handler,
    meaning no action is taken on stack deletion by this function itself.
    """
    helper(event, context)

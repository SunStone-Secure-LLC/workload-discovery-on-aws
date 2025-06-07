# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

"""
This AWS Lambda function is designed to clean up an S3 bucket.
It is typically used as a custom resource in CloudFormation to ensure that
S3 buckets are emptied and deleted when a CloudFormation stack is deleted.
It handles deleting all objects and object versions within a specified bucket.
"""

from botocore.exceptions import ClientError # type: ignore # Used for catching AWS SDK client-side errors.
import boto3 # type: ignore # AWS SDK for Python, used to interact with AWS services like S3.
import functools # Provides tools for higher-order functions, used here for decorators.
import logging # Standard Python logging library.
import os # Provides a way of using operating system dependent functionality.
import json # Used for JSON serialization/deserialization, specifically for logging environment variables.

from crhelper import CfnResource # type: ignore # Custom resource helper for CloudFormation.


# Initializes the CloudFormation custom resource helper.
# json_logging=False: Disables JSON formatting for logs.
# log_level='DEBUG': Sets the logging level to DEBUG for detailed output.
# boto_level='CRITICAL': Sets the boto3 logging level to CRITICAL to reduce verbosity from the SDK.
helper = CfnResource(json_logging=False, log_level='DEBUG',
                     boto_level='CRITICAL')

# Initializes an S3 resource client, which provides a higher-level, object-oriented interface to S3.
s3 = boto3.resource("s3")
# Initializes an S3 client, which provides a lower-level, direct interface to S3 API calls.
client = boto3.client("s3")

# Configures the logger for the Lambda function.
logger = logging.getLogger()
# Sets the logging level based on the 'LogLevel' environment variable, defaulting to INFO.
logger.setLevel(os.getenv("LogLevel", logging.INFO))


def with_logging(handler):
    """
    Decorator which performs basic logging for Lambda event and environment variables.
    It wraps the Lambda handler function, logging input event details and
    making the logger available within the handler's context.
    """

    @functools.wraps(handler)
    def wrapper(event, *args, **kwargs):
        # Logs the name of the handler function being executed.
        logger.debug('## HANDLER: %s', handler.__name__)
        logger.debug('## ENVIRONMENT VARIABLES')
        # Logs all environment variables for debugging purposes.
        logger.debug(json.dumps(os.environ.copy()))
        logger.debug('## EVENT')
        # Logs the incoming Lambda event.
        logger.debug('Event: %s', event)
        # Calls the original handler function with its arguments.
        return handler(event, *args, **kwargs)

    return wrapper

@with_logging # Applies the custom logging decorator.
@helper.create # Decorator to register this function as the handler for CloudFormation Create events.
@helper.update # Decorator to register this function as the handler for CloudFormation Update events.
def create(event, context):
    """
    Handles CloudFormation Create and Update events.
    For bucket cleanup, no specific action is needed on creation or update,
    as the cleanup logic is primarily for deletion.
    """
    return None


@with_logging # Applies the custom logging decorator.
@helper.delete # Decorator to register this function as the handler for CloudFormation Delete events.
def delete(event, _):
    """
    Handles CloudFormation Delete events.
    This function is responsible for emptying the S3 bucket before it can be deleted by CloudFormation.
    It deletes all objects and object versions within the specified bucket.
    """
    # Extracts the bucket name from the CloudFormation resource properties.
    bucket_name = event['ResourceProperties']['Bucket']
    logger.info('Beginning cleanup of ' + bucket_name + '...')
    # Gets an S3 bucket object using the resource client.
    bucket = s3.Bucket(bucket_name)
    try:
        # We need to disable access logging or the access log bucket will never empty.
        # Attempting to resolve this with DependsOn attributes results in numerous
        # circular dependencies.
        # Disables bucket logging to ensure the access log bucket can also be emptied/deleted.
        client.put_bucket_logging(Bucket=bucket_name, BucketLoggingStatus={})
        # Deletes all objects in the bucket.
        bucket.objects.all().delete()
        # Deletes all object versions in the bucket (important for versioned buckets).
        bucket.object_versions.all().delete()
        logger.info(f'Cleanup of {bucket_name} complete.')
        return None
    except ClientError as e:
        # Catches AWS SDK client errors.
        # If the bucket has already been deleted (NoSuchBucket error), log an info message.
        if e.response['Error']['Code'] == 'NoSuchBucket':
            logger.info(f'{bucket_name} has already been deleted')
        else:
            # For any other ClientError, re-raise the exception.
            raise e


def handler(event, context):
    """
    The main Lambda handler function.
    It dispatches the event to the appropriate helper function (create, update, or delete)
    based on the CloudFormation request type.
    """
    helper(event, context)

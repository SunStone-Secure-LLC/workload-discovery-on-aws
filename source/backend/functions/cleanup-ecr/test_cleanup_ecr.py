import sys
import os

# Current directory of test_cleanup_ecr.py: .../source/backend/functions/cleanup-ecr/
current_test_dir = os.path.dirname(os.path.abspath(__file__))

# Path to .../source/backend/functions/
functions_dir = os.path.abspath(os.path.join(current_test_dir, '..'))

# Path to .../source/backend/
backend_dir = os.path.abspath(os.path.join(functions_dir, '..'))

# Path to .../source/
source_dir = os.path.abspath(os.path.join(backend_dir, '..'))


# Add paths to sys.path to allow local module imports
# This mimics the PYTHONPATH setup in run-unit-tests.sh
# cleanup_ecr.py uses:
# from boto_utils import paginate -> needs source/backend/functions/lambda-layers on path
# from lambda_layers.decorators import with_logging -> needs source/backend/functions on path
# The most straightforward way to handle this for tests is to add the 'source' directory
# to the path, allowing imports like `from backend.functions.lambda_layers...` or
# to adjust the sys.path manipulation to correctly point to the parent of `lambda_layers`
# and `boto_utils` for their respective import styles.

# For `from lambda_layers.decorators import with_logging`:
# The parent directory of `lambda_layers` (which is `source/backend/functions`) must be in sys.path.
# This is `functions_dir`.
if functions_dir not in sys.path:
    sys.path.insert(0, functions_dir)

# For `from boto_utils import paginate`:
# The parent directory of `boto_utils` (which is `source/backend/functions/lambda-layers`) must be in sys.path.
# This is `lambda_layers_path`.
lambda_layers_path = os.path.join(functions_dir, 'lambda-layers')
if lambda_layers_path not in sys.path:
    sys.path.insert(0, lambda_layers_path)

# To be absolutely sure, let's also add the 'source' directory itself,
# as this is a common pattern for structuring PYTHONPATH in larger projects.
# This would allow imports like `from backend.functions.lambda_layers...`
# if the code were structured that way.
# For the current import style, the above two should be sufficient, but this is a fallback.
if source_dir not in sys.path:
    sys.path.insert(0, source_dir)

import unittest
from unittest.mock import patch, MagicMock, call
# It's good practice to import the module under test in a way that's clear
# For example:
# from source.backend.functions.cleanup_ecr import cleanup_ecr as ecr_cleaner
# However, if test_cleanup_ecr.py is in the same directory, 'import cleanup_ecr' works.
import cleanup_ecr


class TestCleanupEcr(unittest.TestCase):

    def setUp(self):
        # This mock is for boto3.client if it were called again,
        # but our main target is the already instantiated cleanup_ecr.ecr_client
        self.mock_ecr_constructor_patcher = patch('cleanup_ecr.boto3.client')
        self.mock_boto_client_constructor = self.mock_ecr_constructor_patcher.start()
        self.mock_ecr_instance_for_constructor = MagicMock()
        self.mock_boto_client_constructor.return_value = self.mock_ecr_instance_for_constructor
        self.addCleanup(self.mock_ecr_constructor_patcher.stop)


    def _create_cfn_event(self, request_type, repository_name=None):
        event = {
            'RequestType': request_type,
            'ResourceProperties': {},
            'LogicalResourceId': 'TestResource',
            'RequestId': 'TestRequestId',
            'StackId': 'TestStackId',
            'ServiceToken': 'TestServiceToken',
            'ResponseURL': 'https://example.com/cfnresponse'
        }
        if repository_name:
            event['ResourceProperties']['Repository'] = repository_name
        return event

    # Test for the combined create/update handler
    def test_create_update_events_do_nothing(self):
        create_event = self._create_cfn_event('Create')
        context = MagicMock()
        # The 'create' function in cleanup_ecr.py is decorated by @helper.create and @helper.update
        self.assertIsNone(cleanup_ecr.create(create_event, context))

        update_event = self._create_cfn_event('Update')
        self.assertIsNone(cleanup_ecr.create(update_event, context)) # Same function handles update

    @patch('cleanup_ecr.paginate')
    @patch('cleanup_ecr.ecr_client') # Explicitly patch the global ecr_client for this test
    def test_delete_event_with_images(self, mock_ecr_client_module_global, mock_paginate):
        # mock_ecr_client_module_global is now the mock for cleanup_ecr.ecr_client
        repo_name = "my-test-repo"
        delete_event = self._create_cfn_event('Delete', repository_name=repo_name)
        context = MagicMock()

        mock_image_ids = [{'imageDigest': 'id1'}, {'imageTag': 'tag1'}]
        mock_paginate.return_value = mock_image_ids

        cleanup_ecr.delete(delete_event, context) # This should use mock_ecr_client_module_global

        mock_paginate.assert_called_once_with(
            mock_ecr_client_module_global, # Expect the mocked global client
            mock_ecr_client_module_global.list_images,
            ["imageIds"],
            repositoryName=repo_name
        )
        mock_ecr_client_module_global.batch_delete_image.assert_called_once_with(
            imageIds=mock_image_ids, repositoryName=repo_name
        )

    @patch('cleanup_ecr.paginate')
    @patch('cleanup_ecr.ecr_client') # Explicitly patch the global ecr_client for this test
    def test_delete_event_no_images(self, mock_ecr_client_module_global, mock_paginate):
        # mock_ecr_client_module_global is now the mock for cleanup_ecr.ecr_client
        repo_name = "my-empty-repo"
        delete_event = self._create_cfn_event('Delete', repository_name=repo_name)
        context = MagicMock()

        mock_paginate.return_value = []

        cleanup_ecr.delete(delete_event, context) # This should use mock_ecr_client_module_global

        mock_paginate.assert_called_once_with(
            mock_ecr_client_module_global, # Expect the mocked global client
            mock_ecr_client_module_global.list_images,
            ["imageIds"],
            repositoryName=repo_name
        )
        mock_ecr_client_module_global.batch_delete_image.assert_not_called()

    @patch('cleanup_ecr.helper') # Patch the helper CfnResource instance
    def test_handler_calls_cfn_helper_instance(self, mock_helper_instance):
        # Use any event type, as the handler just passes it to the CfnResource helper
        event = self._create_cfn_event('Create')
        context = MagicMock()
        cleanup_ecr.handler(event, context)
        mock_helper_instance.assert_called_once_with(event, context)

if __name__ == '__main__':
    unittest.main()

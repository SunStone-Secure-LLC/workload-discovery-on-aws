// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * @file This module defines a collection of constants used throughout the Workload Discovery application.
 * These constants include:
 * - Standardized relationship types for graph database interactions.
 * - AWS resource types (e.g., 'AWS::EC2::Instance', 'AWS::S3::Bucket').
 * - Common error messages and codes.
 * - Service-specific identifiers and prefixes.
 * - Other miscellaneous flags and names.
 * Centralizing these values ensures consistency and reduces magic strings in the codebase.
 */

// --- Relationship Types ---
// These constants define the types of relationships between resources in the graph database.
export const IS_ASSOCIATED_WITH = 'Is associated with ';
export const CONTAINS = 'Contains ';
export const IS_CONTAINED_IN = 'Is contained in ';
export const IS_ATTACHED_TO = 'Is attached to ';

// --- Common Error Codes and Messages ---
// Constants representing various AWS API error codes and specific error messages.
export const ACCESS_DENIED = 'AccessDenied';
export const ACCESS_DENIED_EXCEPTION = 'AccessDeniedException';
export const NOT_FOUND_EXCEPTION = 'NotFoundException';
export const CONNECTION_CLOSED_PREMATURELY = 'Connection closed prematurely';
export const RESOLVER_CODE_SIZE_ERROR = 'Reached evaluated resolver code size limit.';
export const FUNCTION_RESPONSE_SIZE_TOO_LARGE = 'Response payload size exceeded maximum allowed payload size (6291556 bytes).';

// --- AWS Service and Resource Type Identifiers ---
// These constants represent various AWS service names and specific AWS resource types
// as defined in AWS Config or other AWS services.
export const AWS = 'aws';
export const AWS_API_GATEWAY_AUTHORIZER = 'AWS::ApiGateway::Authorizer';
export const AWS_API_GATEWAY_METHOD = 'AWS::ApiGateway::Method';
export const AWS_API_GATEWAY_REST_API = 'AWS::ApiGateway::RestApi';
export const AWS_API_GATEWAY_RESOURCE = 'AWS::ApiGateway::Resource';
export const AWS_APPSYNC_GRAPHQLAPI = 'AWS::AppSync::GraphQLApi';
export const AWS_APPSYNC_DATASOURCE = 'AWS::AppSync::DataSource';
export const AWS_APPSYNC_RESOLVER = 'AWS::AppSync::Resolver';
export const AWS_CLOUDFORMATION_STACK = 'AWS::CloudFormation::Stack';
export const AWS_CLOUDFRONT_DISTRIBUTION = 'AWS::CloudFront::Distribution';
export const AWS_CLOUDFRONT_STREAMING_DISTRIBUTION = 'AWS::CloudFront::StreamingDistribution';
export const AWS_COGNITO_USER_POOL = 'AWS::Cognito::UserPool';
export const AWS_CONFIG_RESOURCE_COMPLIANCE = 'AWS::Config::ResourceCompliance';
export const AWS_DYNAMODB_STREAM = 'AWS::DynamoDB::Stream';
export const AWS_DYNAMODB_TABLE = 'AWS::DynamoDB::Table';
export const AWS_EC2_INSTANCE = 'AWS::EC2::Instance';
export const AWS_EC2_INTERNET_GATEWAY = 'AWS::EC2::InternetGateway';
export const AWS_EC2_LAUNCH_TEMPLATE = 'AWS::EC2::LaunchTemplate';
export const AWS_EC2_NAT_GATEWAY = 'AWS::EC2::NatGateway';
export const AWS_EC2_NETWORK_ACL = 'AWS::EC2::NetworkAcl';
export const AWS_EC2_NETWORK_INTERFACE = 'AWS::EC2::NetworkInterface';
export const AWS_EC2_ROUTE_TABLE = 'AWS::EC2::RouteTable';
export const AWS_EC2_SPOT = 'AWS::EC2::Spot';
export const AWS_EC2_SPOT_FLEET = 'AWS::EC2::SpotFleet';
export const AWS_EC2_SUBNET = 'AWS::EC2::Subnet';
export const AWS_EC2_SECURITY_GROUP = 'AWS::EC2::SecurityGroup';
export const AWS_EC2_TRANSIT_GATEWAY = 'AWS::EC2::TransitGateway';
export const AWS_EC2_TRANSIT_GATEWAY_ATTACHMENT = 'AWS::EC2::TransitGatewayAttachment';
export const AWS_EC2_TRANSIT_GATEWAY_ROUTE_TABLE = 'AWS::EC2::TransitGatewayRouteTable';
export const AWS_EC2_VOLUME = 'AWS::EC2::Volume';
export const AWS_EC2_VPC = 'AWS::EC2::VPC';
export const AWS_EC2_VPC_ENDPOINT = 'AWS::EC2::VPCEndpoint';
export const AWS_ECR_REPOSITORY = 'AWS::ECR::Repository';
export const AWS_ECS_CLUSTER = 'AWS::ECS::Cluster';
export const AWS_ECS_SERVICE = 'AWS::ECS::Service';
export const AWS_ECS_TASK = 'AWS::ECS::Task';
export const AWS_ECS_TASK_DEFINITION = 'AWS::ECS::TaskDefinition';
export const AWS_ELASTICSEARCH_DOMAIN = 'AWS::Elasticsearch::Domain';
export const AWS_EVENT_EVENT_BUS = 'AWS::Events::EventBus';
export const AWS_EVENT_RULE = 'AWS::Events::Rule';
export const AWS_KMS_KEY = 'AWS::KMS::Key';
export const AWS_OPENSEARCH_DOMAIN = 'AWS::OpenSearch::Domain';
export const AWS_ELASTIC_LOAD_BALANCING_LOADBALANCER = 'AWS::ElasticLoadBalancing::LoadBalancer';
export const AWS_ELASTIC_LOAD_BALANCING_V2_LOADBALANCER = 'AWS::ElasticLoadBalancingV2::LoadBalancer';
export const AWS_ELASTIC_LOAD_BALANCING_V2_TARGET_GROUP = 'AWS::ElasticLoadBalancingV2::TargetGroup';
export const AWS_ELASTIC_LOAD_BALANCING_V2_LISTENER = 'AWS::ElasticLoadBalancingV2::Listener';
export const AWS_LAMBDA_FUNCTION = 'AWS::Lambda::Function';
export const AWS_RDS_DB_SUBNET_GROUP = 'AWS::RDS::DBSubnetGroup';
export const AWS_RDS_DB_CLUSTER = 'AWS::RDS::DBCluster';
export const AWS_RDS_DB_INSTANCE = 'AWS::RDS::DBInstance';
export const AWS_IAM_GROUP = 'AWS::IAM::Group';
export const AWS_IAM_ROLE = 'AWS::IAM::Role';
export const AWS_IAM_USER = 'AWS::IAM::User';
export const AWS_IAM_AWS_MANAGED_POLICY = 'AWS::IAM::AWSManagedPolicy';
export const AWS_IAM_INLINE_POLICY = 'AWS::IAM::InlinePolicy';
export const AWS_IAM_INSTANCE_PROFILE = 'AWS::IAM::InstanceProfile';
export const AWS_IAM_POLICY = 'AWS::IAM::Policy';
export const AWS_CODEBUILD_PROJECT = 'AWS::CodeBuild::Project';
export const AWS_CODE_PIPELINE_PIPELINE = 'AWS::CodePipeline::Pipeline';
export const AWS_EC2_EIP = 'AWS::EC2::EIP';
export const AWS_EFS_FILE_SYSTEM = 'AWS::EFS::FileSystem';
export const AWS_EFS_ACCESS_POINT = 'AWS::EFS::AccessPoint';
export const AWS_ELASTIC_BEANSTALK_APPLICATION_VERSION = 'AWS::ElasticBeanstalk::ApplicationVersion';
export const AWS_EKS_CLUSTER = 'AWS::EKS::Cluster';
export const AWS_EKS_NODE_GROUP = 'AWS::EKS::Nodegroup';
export const AWS_AUTOSCALING_AUTOSCALING_GROUP = 'AWS::AutoScaling::AutoScalingGroup';
export const AWS_AUTOSCALING_SCALING_POLICY = 'AWS::AutoScaling::ScalingPolicy';
export const AWS_AUTOSCALING_LAUNCH_CONFIGURATION = 'AWS::AutoScaling::LaunchConfiguration';
export const AWS_AUTOSCALING_WARM_POOL = 'AWS::AutoScaling::WarmPool';
export const AWS_KINESIS_STREAM = 'AWS::Kinesis::Stream';
export const AWS_MEDIA_CONNECT_FLOW = 'AWS::MediaConnect::Flow';
export const AWS_MEDIA_CONNECT_FLOW_ENTITLEMENT = 'AWS::MediaConnect::FlowEntitlement';
export const AWS_MEDIA_CONNECT_FLOW_SOURCE = 'AWS::MediaConnect::FlowSource';
export const AWS_MEDIA_CONNECT_FLOW_VPC_INTERFACE = 'AWS::MediaConnect::FlowVpcInterface';
export const AWS_MEDIA_PACKAGE_PACKAGING_CONFIGURATION = 'AWS::MediaPackage::PackagingConfiguration';
export const AWS_MEDIA_PACKAGE_PACKAGING_GROUP = 'AWS::MediaPackage::PackagingGroup';
export const AWS_MEDIA_TAILOR_FLOW_ENTITLEMENT = 'AWS::MediaTailor::PlaybackConfiguration';
export const AWS_MSK_CLUSTER = 'AWS::MSK::Cluster';
export const AWS_REDSHIFT_CLUSTER = 'AWS::Redshift::Cluster';
export const AWS_SERVICE_CATALOG_APP_REGISTRY_APPLICATION = 'AWS::ServiceCatalogAppRegistry::Application';
export const AWS_S3_BUCKET = 'AWS::S3::Bucket';
export const AWS_S3_ACCOUNT_PUBLIC_ACCESS_BLOCK = 'AWS::S3::AccountPublicAccessBlock';
export const AWS_SNS_TOPIC = 'AWS::SNS::Topic';
export const AWS_SQS_QUEUE = 'AWS::SQS::Queue';
export const AWS_SSM_MANAGED_INSTANCE_INVENTORY = 'AWS::SSM::ManagedInstanceInventory';
export const AWS_TAGS_TAG = 'AWS::Tags::Tag';

// --- Application-Specific Identifiers and Flags ---
export const APPLICATION_TAG_NAME = 'awsApplication'; // The name of the tag used to identify applications.
export const AWS_ORGANIZATIONS = 'AWS_ORGANIZATIONS'; // String constant indicating usage of AWS Organizations for discovery.
export const DISCOVERY_ROLE_NAME = 'WorkloadDiscoveryRole'; // The name of the IAM role used for discovery.
export const ECS = 'ecs'; // Identifier for Elastic Container Service.
export const ELASTIC_LOAD_BALANCING = 'elasticloadbalancing'; // Identifier for Elastic Load Balancing service.
export const LOAD_BALANCER = 'loadbalancer'; // Generic identifier for a load balancer.
export const ENI_NAT_GATEWAY_INTERFACE_TYPE = 'nat_gateway'; // Interface type for NAT Gateway ENIs.
export const ENI_ALB_DESCRIPTION_PREFIX = 'ELB app'; // Description prefix for Application Load Balancer ENIs.
export const ENI_ELB_DESCRIPTION_PREFIX = 'ELB '; // Description prefix for Classic Load Balancer ENIs.
export const ENI_VPC_ENDPOINT_INTERFACE_TYPE = 'vpc_endpoint'; // Interface type for VPC Endpoint ENIs.
export const ENI_SEARCH_DESCRIPTION_PREFIX = 'ES '; // Description prefix for OpenSearch/Elasticsearch ENIs.
export const ENI_SEARCH_REQUESTER_ID = 'amazon-elasticsearch'; // Requester ID for OpenSearch/Elasticsearch ENIs.
export const IAM = 'iam'; // Identifier for Identity and Access Management service.
export const ROLE = 'role'; // Generic identifier for an IAM role.
export const LAMBDA = 'lambda'; // Identifier for AWS Lambda service.
export const GLOBAL = 'global'; // Indicates a global AWS resource.
export const REGION = 'region'; // Indicates a regional AWS resource.
export const REGIONAL = 'regional'; // Indicates a regional scope.
export const NETWORK_INTERFACE = 'NetworkInterface'; // Generic identifier for a network interface.
export const NETWORK_INTERFACE_ID = 'networkInterfaceId'; // Property name for network interface ID.
export const NOT_APPLICABLE = 'Not Applicable'; // Standard string for "not applicable" values.
export const MULTIPLE_AVAILABILITY_ZONES = 'Multiple Availability Zones'; // Description for resources spanning multiple AZs.
export const SPOT_FLEET_REQUEST_ID_TAG = 'aws:ec2spot:fleet-request-id'; // Tag key for EC2 Spot Fleet request ID.
export const SUBNET_ID = 'subnetId'; // Property name for subnet ID.
export const GET = 'GET'; // HTTP GET method.
export const POST = 'POST'; // HTTP POST method.
export const PUT = 'PUT'; // HTTP PUT method.
export const DELETE = 'DELETE'; // HTTP DELETE method.
export const SUBNET = 'Subnet'; // Generic identifier for a subnet.
export const OPENSEARCH = 'OpenSearch'; // Identifier for OpenSearch service.
export const SECURITY_GROUP = 'SecurityGroup'; // Generic identifier for a security group.
export const RESOURCE_DISCOVERED =  'ResourceDiscovered'; // Event type for a discovered resource.
export const RESOURCE_NOT_RECORDED =  'ResourceNotRecorded'; // Event type for a resource not recorded.
export const EC2 = 'ec2'; // Identifier for Elastic Compute Cloud service.
export const SPOT_FLEET_REQUEST = 'spot-fleet-request'; // Identifier for a Spot Fleet request.
export const SPOT_INSTANCE_REQUEST = 'spot-instance-request'; // Identifier for a Spot Instance request.
export const INLINE_POLICY = 'inlinePolicy'; // Identifier for an inline IAM policy.
export const TAG = 'tag'; // Generic identifier for a tag.
export const TAGS = 'tags'; // Generic identifier for tags collection.
export const VPC = 'Vpc'; // Generic identifier for a Virtual Private Cloud.
export const APIGATEWAY = 'apigateway'; // Identifier for API Gateway service.
export const RESTAPIS = 'restapis'; // Identifier for REST APIs.
export const RESOURCES = 'resources'; // Generic identifier for resources.
export const METHODS = 'methods'; // Identifier for API Gateway methods.
export const AUTHORIZERS = 'authorizers'; // Identifier for API Gateway authorizers.
export const EVENTS = 'events'; // Identifier for EventBridge service.
export const EVENT_BUS = 'event-bus'; // Identifier for an EventBridge event bus.
export const NAME = 'Name'; // Common property name for a resource's name.
export const CN_NORTH_1 = 'cn-north-1'; // AWS China (Beijing) region.
export const CN_NORTHWEST_1 = 'cn-northwest-1'; // AWS China (Ningxia) region.
export const US_GOV_EAST_1 = 'us-gov-east-1'; // AWS GovCloud (US-East) region.
export const US_GOV_WEST_1 = 'us-gov-west-1'; // AWS GovCloud (US-West) region.
export const AWS_CN = 'aws-cn'; // Partition for AWS China regions.
export const AWS_US_GOV = 'aws-us-gov'; // Partition for AWS GovCloud regions.
export const PERSPECTIVE = 'perspective'; // Identifier for a perspective view.
export const TASK_DEFINITION = 'task-definition'; // Identifier for an ECS task definition.
export const TRANSIT_GATEWAY_ATTACHMENT = 'transit-gateway-attachment'; // Identifier for a Transit Gateway Attachment.
export const UNKNOWN = 'unknown'; // Generic string for unknown values.
export const DISCOVERY_PROCESS_RUNNING = 'Discovery process ECS task is already running in cluster.'; // Message indicating discovery process is already active.
export const CONSOLE = 'console'; // Identifier for AWS Console.
export const SIGN_IN = 'signin'; // Identifier for sign-in related actions.
export const AWS_AMAZON_COM = 'aws.amazon.com'; // AWS domain.
export const S3 = 's3'; // Identifier for Amazon S3 service.
export const HOME = 'home'; // Generic identifier for a home path/route.
export const FULFILLED = 'fulfilled'; // Promise status indicating successful completion.
export const WORKLOAD_DISCOVERY_TASKGROUP = 'workload-discovery-taskgroup'; // Task group name for Workload Discovery ECS tasks.

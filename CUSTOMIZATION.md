# Workload Discovery on AWS Customization Guide

This document provides guidance on customizing your Workload Discovery on AWS deployment to integrate with existing AWS resources and deploy within an AWS Control Tower Landing Zone Accelerator (LZA) environment.

## 1. Use an Existing VPC

By default, Workload Discovery on AWS provisions a new Amazon Virtual Private Cloud (VPC) to host its resources. However, you can configure the deployment to use an existing VPC, which is beneficial for maintaining network consistency, leveraging existing network infrastructure, and adhering to organizational network policies.

### Prerequisites

*   An existing VPC in the AWS Region where you plan to deploy Workload Discovery on AWS.
    *   **To confirm this prerequisite**, you can use the AWS CLI command `aws ec2 describe-vpcs` to list your existing VPCs in a specific region. Replace `your-aws-region` with your desired AWS Region (e.g., `us-east-1`).
        ```bash
        aws ec2 describe-vpcs --query "Vpcs[*].{VpcId:VpcId,CidrBlock:CidrBlock,IsDefault:IsDefault}" --output table --region your-aws-region
        ```
        If you encounter an "Unable to locate credentials" error, run `aws configure` to set up your AWS CLI credentials.
*   Two private subnets within the existing VPC. These subnets must have routes to the internet (e.g., via NAT Gateway) and to required AWS services (e.g., S3, ECR via VPC Endpoints) to allow the solution's components (like the discovery ECS task) to function correctly.
    *   **To confirm this prerequisite**, you can list subnets within your VPC using the AWS CLI command `aws ec2 describe-subnets`. Replace `your-vpc-id` and `your-aws-region` with your VPC ID and desired AWS Region (e.g., `us-east-1`).
        ```bash
        aws ec2 describe-subnets --filters "Name=vpc-id,Values=your-vpc-id" --query "Subnets[*].{SubnetId:SubnetId,AvailabilityZone:AvailabilityZone,CidrBlock:CidrBlock}" --output table --region your-aws-region
        ```
        After identifying your private subnets, you will need to manually verify their associated route tables to ensure they have routes to a NAT Gateway for internet access and to necessary VPC Endpoints for AWS services (S3, ECR, etc.). You can inspect route tables using `aws ec2 describe-route-tables`.
*   The CIDR block of your existing VPC. This value is required as a CloudFormation parameter when using an existing VPC. You can find the `CidrBlock` value associated with your VPC ID in the output of the `aws ec2 describe-vpcs` command.
*   Appropriate security group configurations to allow communication between Workload Discovery components and AWS services.
    *   **To confirm this prerequisite**, you can list your security groups using the AWS CLI command `aws ec2 describe-security-groups`. Replace `your-aws-region` with your desired AWS Region.
        ```bash
        aws ec2 describe-security-groups --query "SecurityGroups[*].{GroupId:GroupId,GroupName:GroupName,IpPermissions:IpPermissions,IpPermissionsEgress:IpPermissionsEgress}" --output table --region your-aws-region
        ```
        You will need to manually inspect the ingress and egress rules of relevant security groups to ensure they allow necessary traffic between Workload Discovery components (e.g., Neptune, OpenSearch, Lambda functions, ECS tasks) and required AWS services.

### Configuration Steps

When deploying the Workload Discovery on AWS CloudFormation template (`main.template`), provide the following parameters:

*   **`VpcId`**: The ID of your existing VPC (e.g., `vpc-0123456789abcdef0`).
*   **`VpcCidrBlock`**: The CIDR block of your existing VPC (e.g., `10.0.0.0/16`).
*   **`PrivateSubnet0`**: The ID of the first private subnet in your VPC (e.g., `subnet-0abcdef1234567890`).
*   **`PrivateSubnet1`**: The ID of the second private subnet in your VPC (e.g., `subnet-0fedcba9876543210`).

By providing these parameters, the solution's CloudFormation stack will skip the creation of a new VPC and instead utilize your specified network infrastructure.

### Considerations/Limitations

*   Ensure your existing private subnets have outbound access to the internet (via NAT Gateway) and to necessary AWS service endpoints (e.g., S3, ECR, CloudWatch, AppSync, Cognito, Neptune, OpenSearch) for the solution's components to operate correctly. This internet access is crucial for components like the discovery ECS task to pull Docker images, download updates, and interact with external services not covered by VPC Endpoints.
*   Verify that the security groups associated with your existing subnets and any custom security groups allow the necessary ingress and egress traffic for the Workload Discovery components (e.g., Neptune, OpenSearch, Lambda functions, ECS tasks).
*   If your existing VPC has custom DNS settings, ensure they do not interfere with AWS service endpoint resolution. When using custom DNS servers (configured via DHCP option sets), instances in your VPC will forward DNS queries to these servers. If these custom DNS servers are not configured to correctly resolve AWS public service endpoints (e.g., `s3.us-east-1.amazonaws.com`) or private VPC endpoint hostnames (which resolve to private IPs within your VPC), Workload Discovery components may experience connectivity issues. This often requires configuring conditional forwarders on your custom DNS servers to forward AWS domain queries to the AWS provided DNS resolver (e.g., `VPC_CIDR_RANGE.2`).

## 2. Use an Existing Neptune Cluster

The current Workload Discovery on AWS CloudFormation templates are designed to provision a new Amazon Neptune cluster as part of the deployment. Direct integration with an existing Neptune cluster by simply providing its endpoint is **not natively supported** through the standard CloudFormation parameters.

To integrate with an existing Neptune cluster, you would need to modify the solution's CloudFormation templates. This typically involves:

### Overview

Integrating with an existing Neptune cluster can be desirable if you already have a managed graph database, wish to consolidate resources, or have specific compliance requirements for database provisioning.

### Prerequisites

*   An existing Amazon Neptune DB cluster.
*   The endpoint address and port of your Neptune cluster.
*   Network connectivity between the Workload Discovery components (specifically the Gremlin resolvers Lambda functions) and your existing Neptune cluster. This usually means the Neptune cluster must be accessible from the private subnets where Workload Discovery's Lambda functions are deployed.
*   Appropriate security group configurations on your existing Neptune cluster to allow ingress traffic from the security groups associated with Workload Discovery's Lambda functions.
*   IAM permissions for Workload Discovery's components to access your existing Neptune cluster.

### Configuration Steps (Requires CloudFormation Template Modification)

1.  **Modify `source/cfn/templates/main.template`:**
    *   Add new parameters to accept the existing Neptune cluster's endpoint and port, for example:
        ```yaml
        ExistingNeptuneClusterEndpoint:
          Type: String
          Default: ''
          Description: (Optional) The endpoint of an existing Neptune cluster to use. Leave blank to provision a new cluster.
        ExistingNeptuneClusterPort:
          Type: String
          Default: ''
          Description: (Optional) The port of an existing Neptune cluster to use. Required if ExistingNeptuneClusterEndpoint is provided.
        ```
    *   Add a condition to check if an existing Neptune endpoint is provided:
        ```yaml
        UseExistingNeptune: !Not [!Equals [!Ref ExistingNeptuneClusterEndpoint, '']]
        ```
    *   Conditionally create the `NeptuneStack` based on this new condition. If `UseExistingNeptune` is true, skip the `NeptuneStack` creation.
        ```yaml
        NeptuneStack:
          Type: AWS::CloudFormation::Stack
          Condition: !Not [UseExistingNeptune] # Only create if not using existing
          Properties:
            # ... existing properties ...
        ```
    *   Modify the `GremlinResolversStack` parameters to conditionally use the new `ExistingNeptuneClusterEndpoint` and `ExistingNeptuneClusterPort` parameters, or the outputs from the `NeptuneStack` if a new one is provisioned:
        ```yaml
        GremlinResolversStack:
          Type: AWS::CloudFormation::Stack
          Properties:
            # ... other parameters ...
            NeptuneClusterURL: !If [UseExistingNeptune, !Ref ExistingNeptuneClusterEndpoint, !GetAtt NeptuneStack.Outputs.NeptuneEndpointAddress]
            NeptuneClusterPort: !If [UseExistingNeptune, !Ref ExistingNeptuneClusterPort, !GetAtt NeptuneStack.Outputs.NeptuneEndpointPort]
            NeptuneDbSg: !If [UseExistingNeptune, !Ref ExistingNeptuneSecurityGroup, !GetAtt NeptuneStack.Outputs.NeptuneDbSg] # You might need a new parameter for existing SG
            # ...
        ```
2.  **Consider `source/cfn/templates/neptune.template`:** This template would remain largely unchanged, as it's only used when a new Neptune cluster is provisioned.
3.  **Security Group Management:**
    *   If your existing Neptune cluster is in a different VPC or requires specific security group rules, you might need to introduce a new parameter in `main.template` (e.g., `ExistingNeptuneSecurityGroup`) to pass the ID of the security group that allows access to your existing Neptune cluster.
    *   **Important:** The `NeptuneDbSgIngressRule` resource within the `source/cfn/templates/gremlin-resolvers.template` is responsible for creating an ingress rule in the Neptune database's security group to allow traffic from the Gremlin resolver Lambda function. This rule is now conditional and will **not** be created if you set the `UseExistingNeptune` parameter (in `gremlin-resolvers.template`, which is typically set via `main.template`'s `ExistingNeptuneClusterEndpoint` parameter logic) to `true` (or provide an existing Neptune endpoint).
    *   **Action Required for Existing Neptune:** If you are using an existing Neptune cluster, you **must** manually ensure that an equivalent security group ingress rule exists. This rule should allow TCP traffic on your Neptune cluster's port (e.g., 8182) from the security group associated with the `GremlinResolverLambdaSg` (the Gremlin AppSync Lambda function's security group, created by `gremlin-resolvers.template`).
        *   If your existing Neptune cluster is in the **same VPC** as the Workload Discovery deployment, you need to add an inbound rule to your Neptune cluster's security group that sources the `GremlinResolverLambdaSg` ID.
        *   If your existing Neptune cluster is in a **different VPC**, you will first need to establish cross-VPC connectivity (e.g., VPC Peering, AWS Transit Gateway). Then, you must configure the security group rules to allow traffic from the Gremlin resolver Lambda's source IP range or security group (if VPC peering allows referencing security groups across accounts/regions).
    *   Failure to configure this ingress rule correctly will prevent the Gremlin resolver Lambda from connecting to your Neptune database, causing errors in graph data operations.

### Considerations/Limitations

*   Modifying CloudFormation templates requires careful testing to ensure the solution functions as expected.
*   You are responsible for managing the lifecycle, scaling, and security of your existing Neptune cluster.
*   Ensure version compatibility between your existing Neptune cluster and the Workload Discovery solution.
*   Network connectivity and security group configurations are critical for successful integration.

## 3. Use an Existing OpenSearch Cluster

Similar to Neptune, the current Workload Discovery on AWS CloudFormation templates are designed to provision a new Amazon OpenSearch Service cluster. Direct integration with an existing OpenSearch cluster by simply providing its endpoint is **not natively supported** through the standard CloudFormation parameters.

To integrate with an existing OpenSearch cluster, you would need to modify the solution's CloudFormation templates. This typically involves:

### Overview

Using an existing OpenSearch cluster can be beneficial for centralizing search capabilities, leveraging existing infrastructure, or adhering to specific operational standards.

### Prerequisites

*   An existing Amazon OpenSearch Service domain.
*   The domain endpoint of your OpenSearch cluster.
*   Network connectivity between the Workload Discovery components (specifically the Search resolvers Lambda functions) and your existing OpenSearch cluster. This usually means the OpenSearch cluster must be accessible from the private subnets where Workload Discovery's Lambda functions are deployed.
*   Appropriate security group configurations on your existing OpenSearch cluster to allow ingress traffic from the security groups associated with Workload Discovery's Lambda functions.
*   IAM permissions for Workload Discovery's components to access your existing OpenSearch cluster. The `SearchLambdaIAMRoleARN` parameter in `opensearch.template` indicates that the search Lambda's IAM role needs access.

### Configuration Steps (Requires CloudFormation Template Modification)

1.  **Modify `source/cfn/templates/main.template`:**
    *   Add a new parameter to accept the existing OpenSearch domain endpoint, for example:
        ```yaml
        ExistingOpenSearchDomainEndpoint:
          Type: String
          Default: ''
          Description: (Optional) The endpoint of an existing OpenSearch domain to use. Leave blank to provision a new domain.
        ```
    *   Add a condition to check if an existing OpenSearch endpoint is provided:
        ```yaml
        UseExistingOpenSearch: !Not [!Equals [!Ref ExistingOpenSearchDomainEndpoint, '']]
        ```
    *   Conditionally create the `OpenSearchStack` based on this new condition. If `UseExistingOpenSearch` is true, skip the `OpenSearchStack` creation.
        ```yaml
        OpenSearchStack:
          Type: AWS::CloudFormation::Stack
          Condition: !Not [UseExistingOpenSearch] # Only create if not using existing
          Properties:
            # ... existing properties ...
        ```
    *   Modify the `SearchResolversStack` parameters to conditionally use the new `ExistingOpenSearchDomainEndpoint` parameter, or the output from the `OpenSearchStack` if a new one is provisioned:
        ```yaml
        SearchResolversStack:
          Type: AWS::CloudFormation::Stack
          Properties:
            # ... other parameters ...
            OpenSearchDomainEndpoint: !If [UseExistingOpenSearch, !Ref ExistingOpenSearchDomainEndpoint, !GetAtt OpenSearchStack.Outputs.DomainEndpoint]
            OpenSearchSg: !If [UseExistingOpenSearch, !Ref ExistingOpenSearchSecurityGroup, !GetAtt OpenSearchStack.Outputs.OpenSearchSg] # You might need a new parameter for existing SG
            # ...
        ```
2.  **Consider `source/cfn/templates/opensearch.template`:** This template would remain largely unchanged, as it's only used when a new OpenSearch domain is provisioned.
3.  **Security Group Management:** If your existing OpenSearch cluster is in a different VPC or requires specific security group rules, you might need to introduce a new parameter in `main.template` (e.g., `ExistingOpenSearchSecurityGroup`) to pass the ID of the security group that allows access to your existing OpenSearch cluster.

### Considerations/Limitations

*   Modifying CloudFormation templates requires careful testing to ensure the solution functions as expected.
*   You are responsible for managing the lifecycle, scaling, and security of your existing OpenSearch cluster.
*   Ensure version compatibility between your existing OpenSearch cluster and the Workload Discovery solution.
*   Network connectivity and security group configurations are critical for successful integration.

## 4. Deploy via Control Tower Landing Zone Accelerator (LZA)

Workload Discovery on AWS can be deployed within an AWS Control Tower environment, leveraging the capabilities of the Landing Zone Accelerator (LZA) for multi-account and multi-Region deployments. This approach allows you to centralize management and ensure consistent governance across your AWS Organization.

### Overview

LZA provides a well-architected framework for deploying and managing AWS environments at scale. Deploying Workload Discovery within LZA allows you to extend its discovery capabilities across your organizational units (OUs) and member accounts, centralizing workload visibility.

### Prerequisites

*   An active AWS Control Tower deployment with LZA configured.
*   Understanding of your AWS Organization structure, including OUs and member accounts.
*   Appropriate IAM permissions in your Control Tower management account or delegated administrator account to deploy CloudFormation StackSets.

### Configuration Steps

Workload Discovery on AWS supports AWS Organizations integration through specific CloudFormation parameters in `main.template`:

*   **`CrossAccountDiscovery`**: Set this parameter to `AWS_ORGANIZATIONS`. This enables the solution to discover resources across accounts managed by AWS Organizations.
*   **`OrganizationUnitId`**: Provide the ID of the organizational unit (OU) you wish Workload Discovery to discover. This is typically the root OU ID (e.g., `ou-xxxx-xxxxxxxx`). The solution will then discover resources in all accounts within this OU and its nested OUs.
*   **`AccountType`**: Specify the type of AWS Organizations account where Workload Discovery is being installed.
    *   `MANAGEMENT`: If deploying in the Control Tower management account.
    *   `DELEGATED_ADMIN`: If deploying in a delegated administrator account for AWS Organizations.
*   **`ConfigAggregatorName`**: (Optional) If you have an existing AWS Organization-wide AWS Config aggregator (e.g., `aws-controltower-ConfigAggregatorForOrganizations` created by LZA), you can provide its name here. If left blank, a new aggregator will be created. It is recommended to use an existing LZA-managed aggregator if available.

When these parameters are configured, the `OrganizationsGlobalResourcesStack` in `main.template` will be deployed. This stack utilizes CloudFormation StackSets to deploy necessary IAM roles and resources into the target accounts within the specified `OrganizationUnitId`, enabling cross-account discovery.

### Control Tower / LZA Specifics

#### Multi-Account Deployment Strategy

*   **Management Account / Delegated Admin Account**: Deploy the main Workload Discovery CloudFormation stack in your Control Tower management account or a designated delegated administrator account. This account will host the central Workload Discovery application, including the UI, API, Neptune, and OpenSearch clusters.
*   **Workload/Tenant Accounts**: The solution leverages CloudFormation StackSets (managed by the `OrganizationsGlobalResourcesStack`) to deploy a read-only IAM role (`DiscoveryRoleArn`) into each member account within the specified `OrganizationUnitId`. This role grants Workload Discovery the necessary permissions to discover resources in those accounts.

#### IAM Roles and Permissions

*   **`DiscoveryRoleArn`**: This role is deployed via StackSets into member accounts and is assumed by the Workload Discovery discovery process to collect resource data. Ensure that any Service Control Policies (SCPs) in your LZA environment do not restrict the permissions required by this role.
*   **Existing Config Aggregator**: If you use an existing LZA-managed Config aggregator, ensure its permissions allow Workload Discovery to access the aggregated configuration data.

#### Network Considerations

*   **Shared Services VPCs**: If your LZA setup includes shared services VPCs, you can utilize the "Use an Existing VPC" customization (Section 1) to deploy Workload Discovery's network-dependent components (Neptune, OpenSearch, ECS tasks) into these shared VPCs. This aligns with LZA's best practices for centralizing network services.
*   **VPC Endpoints**: Ensure that necessary VPC endpoints (e.g., for S3, ECR, CloudWatch, STS, Config) are configured in your LZA-managed VPCs to allow private connectivity for Workload Discovery components, especially if you are not using NAT Gateways for internet access.

### Considerations/Limitations

*   Ensure that the `OrganizationUnitId` provided is correct and that the deployment account has permissions to create StackSets and deploy resources into the target OUs.
*   Review your LZA's SCPs to ensure they do not inadvertently block any AWS API calls required by Workload Discovery's discovery process or its deployed components.
*   Monitor CloudFormation StackSet instances for deployment failures in member accounts and troubleshoot any permission or resource conflicts.

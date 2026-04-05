# infra/main.tf — root Terraform configuration for project-hammer
#
# Provisions:
#   - Frontend hosting stack via the ./modules/frontend module
#     (S3, CloudFront, ACM, Route53)
#
# The backend (Fly.io) is managed via flyctl, not Terraform.
# See server/DEPLOY.md for Fly.io deployment instructions.
#
# BOOTSTRAP (one-time, before first `terraform init`):
#   aws s3api create-bucket \
#     --bucket project-hammer-tfstate \
#     --region ca-central-1 \
#     --create-bucket-configuration LocationConstraint=ca-central-1
#
#   # Enable versioning on the state bucket so you can recover from a bad apply
#   aws s3api put-bucket-versioning \
#     --bucket project-hammer-tfstate \
#     --versioning-configuration Status=Enabled

terraform {
  required_version = ">= 1.6"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Remote state stored in S3 — never use local state for shared infrastructure.
  # The bucket must exist before running `terraform init` (see bootstrap above).
  backend "s3" {
    bucket = "project-hammer-tfstate"
    key    = "production/terraform.tfstate"
    region = "ca-central-1"
  }
}

# ---------------------------------------------------------------------------
# AWS provider configuration
# ---------------------------------------------------------------------------

# Primary provider — ca-central-1 for S3 and most resources.
provider "aws" {
  region = "ca-central-1"
}

# us-east-1 alias — ACM certificates used by CloudFront MUST be provisioned
# here.  CloudFront is a global service that only reads ACM certs from us-east-1.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
}

# ---------------------------------------------------------------------------
# Frontend infrastructure module
# ---------------------------------------------------------------------------

module "frontend" {
  source = "./modules/frontend"

  domain_name = var.domain_name
  zone_name   = var.zone_name
  environment = var.environment

  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }
}

variable "aws_region" {
  description = "Primary AWS region for the S3 bucket."
  type        = string
  default     = "ca-central-1"
}

variable "domain_name" {
  description = "The fully-qualified domain name for the frontend (e.g. ferries.yyz.live)."
  type        = string
  default     = "ferries.yyz.live"
}

variable "zone_name" {
  description = "The Route53 hosted zone root domain (e.g. yyz.live). Must match the registrar-delegated zone."
  type        = string
  default     = "yyz.live"
}

variable "environment" {
  description = "Deployment environment tag applied to all resources."
  type        = string
  default     = "production"
}
